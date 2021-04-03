import clone from "clone";
import getClient from "@/db";
import parserUtils from "./parser-utils";
import { parse, deparse } from "pgsql-parser";

export default async function findProblems(table, column, value, query) {
  let client = await getClient();

  await client.query("SET search_path = curator");


  let stmts = parse(query);

  // Limit real query to 1 result and select nothing for speed
  stmts[0].RawStmt.stmt.SelectStmt.limitCount = parserUtils.wrapConst(1);
  stmts[0].RawStmt.stmt.SelectStmt.targetList = [
    {
      ResTarget: { val: parserUtils.wrapConst(1) },
    },
  ];

  let findRecordExpr = createExprToFindRecord(table, column, value);
  let whereProblems = await findWhereProblems(stmts[0], findRecordExpr);
  let joinProblems = await findJoinProblems(stmts[0], findRecordExpr);

  return {
    where: findIndexes(query, whereProblems),
    join:  findIndexes(query, joinProblems)
  };

  // console.log(
  //   `There were ${whereProblems.length} potential problems found in WHERE clause:`
  // );
  // outputProblems(query, whereProblems);

  // console.log(
  //   `There were ${joinProblems.length} potential problems found in your INNER joins:`
  // );
  // outputProblems(query, joinProblems);
}

function findIndexes(query, problems) {
  return problems.map(problem => {
    let condition = deparse(problem);
    let key = Object.keys(problem)[0];
    return [problem[key].location, condition.length];
  });
}

function outputProblems(realQuery, problems) {
  for (let i = 0; i < problems.length; i++) {
    let condition = deparse(problems[i]);
    let index = realQuery.indexOf(condition);

    console.log(
      i + 1 + ": " + condition + " - Index starts at ",
      index + ", ends at " + (index + condition.length)
    );
  }
}

function createExprToFindRecord(table_alias, column, id) {
  return {
    A_Expr: {
      kind: "AEXPR_OP",
      name: [{ String: { str: "=" } }],
      lexpr: {
        ColumnRef: {
          fields: [
            parserUtils.wrapDataType(table_alias),
            parserUtils.wrapDataType(column),
          ],
        },
      },
      rexpr: parserUtils.wrapConst(id),
    },
  };
}

async function findWhereProblems(stmt, findRecordExpr) {
  let whereClause = stmt.RawStmt.stmt.SelectStmt.whereClause;

  if (!whereClause) {
    // No where clause, so must not be a problem
    return [];
  }

  let tree = clone(stmt);
  let joinExprs = tree.RawStmt.stmt.SelectStmt.fromClause.filter(
    (expr) => expr.JoinExpr
  );

  // TODO: figure out if possible to do joins and where at same time
  // joinExprs.forEach(setDummyQual);

  if (!whereClause.BoolExpr || whereClause.BoolExpr.boolop !== "AND_EXPR") {
    delete tree.RawStmt.stmt.SelectStmt.whereClause;

    let query = deparse([tree]);
    let client = await getClient();
    let result = await client.query(query);

    return result.rowCount > 0 ? [whereClause] : [];
  }

  let expressions = mapLeafExpressions(whereClause.BoolExpr.args);

  return findProblemsFromExpressions(tree, findRecordExpr, expressions);
}

async function findJoinProblems(stmt, findRecordExpr) {
  let tree = clone(stmt);
  let client = await getClient();

  tree.RawStmt.stmt.SelectStmt.whereClause = findRecordExpr;

  let query = deparse([tree]);
  let result = await client.query(query);
  if (result.rowCount > 0) {
    return []; // No join problems since it was found
  }

  let inners = tree.RawStmt.stmt.SelectStmt.fromClause.filter(
    (expr) => expr.JoinExpr && expr.JoinExpr.jointype === "JOIN_INNER"
  );
  let lefts = tree.RawStmt.stmt.SelectStmt.fromClause.filter(
    (expr) => expr.JoinExpr && expr.JoinExpr.jointype === "JOIN_LEFT"
  );

  let expressions = inners.map((expr) => mapJoinExprs(expr.JoinExpr)).flat();
  let boolExprs = expressions.filter(
    (e) => e.BoolExpr && e.BoolExpr.boolop === "AND_EXPR"
  );
  let leafs = boolExprs.map((b) => mapLeafExpressions(b.BoolExpr.args)).flat();

  expressions = expressions
    .filter((e) => !e.BoolExpr || e.BoolExpr.boolop !== "AND_EXPR")
    .concat(leafs);

  inners.forEach(setDummyQual);

  // TODO: implement check to see if left join table is referenced in where clause, but not a NULL check
  // may indicate should be left join or where clause should be in left join query
  lefts;

  return await findProblemsFromExpressions(tree, findRecordExpr, expressions);
}

function mapJoinExprs(joinExpr) {
  let quals = [joinExpr.quals];

  if (joinExpr.larg.JoinExpr) {
    quals.push.apply(quals, mapJoinExprs(joinExpr.larg.JoinExpr));
  }

  if (joinExpr.rarg.JoinExpr) {
    quals.push.apply(quals, mapJoinExprs(joinExpr.rarg.JoinExpr));
  }

  return quals;
}

function mapLeafExpressions(andExprConditions) {
  let expressions = [];

  for (let i = andExprConditions.length - 1; i >= 0; i--) {
    let is_and_cond =
      andExprConditions[i].BoolExpr &&
      andExprConditions[i].BoolExpr.boolop === "AND_EXPR";

    if (is_and_cond) {
      expressions.push.apply(
        expressions,
        mapLeafExpressions(andExprConditions[i].BoolExpr.args)
      );
    } else {
      expressions.push(andExprConditions[i]);
    }
  }

  return expressions;
}

function setDummyQual(expr) {
  expr.JoinExpr.quals = parserUtils.wrapEqualCondition(1, 1);

  if (expr.JoinExpr.larg.JoinExpr) {
    setDummyQual(expr.JoinExpr.larg);
  }

  if (expr.JoinExpr.rarg.JoinExpr) {
    setDummyQual(expr.JoinExpr.rarg);
  }
}

async function findProblemsFromExpressions(tree, findRecordExpr, expressions) {
  let problems = [];
  let promises = [];

  for (let i = 0; i < expressions.length; i++) {
    let expr = parserUtils.wrapBoolExpr("AND_EXPR", [
      findRecordExpr,
      expressions[i],
    ]);

    let promise = queryHasResultsWithWhereExpr(tree, expr, i).then(
      ({ has_result, input }) => {
        if (!has_result) {
          problems.push(expressions[input]);
        }
      }
    );

    promises.push(promise);
  }

  await Promise.all(promises);

  return problems;
}

async function queryHasResultsWithWhereExpr(tree, expr, input) {
  let test = clone(tree);
  let client = await getClient();

  test.RawStmt.stmt.SelectStmt.whereClause = expr;

  let query = deparse([test]);
  let result = await client.query(query);

  return {
    input,
    has_result: result.rowCount > 0,
  };
}
