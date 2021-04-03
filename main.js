const {parse, deparse} = require('pgsql-parser');
const {Client}         = require('pg');
const prompt           = require('prompt-sync')();
const clone            = require('clone');

let client;

(async function() {

    client = new Client({
        host: 'localhost',
        port: 8080,
        user: '',
        password: ''
    });
    await client.connect();

    await client.query("SET search_path = lister");

    console.log("Type in the table and primary key of the record that isn't showing up.");
    // const table  = prompt("Table: ");
    // const column = await getPrimaryColumn(table);
    // const id     = prompt(`${column}: `);
    const table       = 'platform_posts';
    const column      = 'id';
    const id          = 234505;
    const table_alias = 'pp';
    // const table       = 'stories';
    // const column      = 'id';
    // const id          = 1283022;
    // const table_alias = 'stories';

    const data        = await getFirstRow(`SELECT * FROM ${table} WHERE ${column} = ${id}`);
    const realQuery = getRealQuery();

    stmts = parse(realQuery);

    // Limit real query to 1 result and select nothing for speed
    stmts[0].RawStmt.stmt.SelectStmt.limitCount = wrapConst(1);
    stmts[0].RawStmt.stmt.SelectStmt.targetList = [
        {
            ResTarget: { val: wrapConst(1) }
        }
    ];

    let findRecordExpr = createExprToFindRecord(table_alias, column, id);
    let whereProblems  = await findWhereProblems(stmts[0], findRecordExpr);
    let joinProblems   = await findJoinProblems(stmts[0], findRecordExpr);

    console.log(`There were ${whereProblems.length} potential problems found in WHERE clause:`);
    outputProblems(realQuery, whereProblems);

    console.log(`There were ${joinProblems.length} potential problems found in your INNER joins:`);
    outputProblems(realQuery, joinProblems);

    client.end();
}());

function outputProblems(realQuery, problems) {
    for (let i = 0; i < problems.length; i++) {
        let condition = deparse(problems[i]);
        let index     = realQuery.indexOf(condition);

        console.log((i + 1) + ': ' + condition + ' - Index starts at ', index + ', ends at ' + (index + condition.length));
    }
}

async function findJoinProblems(stmt, findRecordExpr) {
    let tree = clone(stmt);

    tree.RawStmt.stmt.SelectStmt.whereClause = findRecordExpr;

    let query  = deparse([tree]);
    let result = await client.query(query);
    if (result.rowCount > 0) {
        return []; // No join problems since it was found
    }

    let inners = tree.RawStmt.stmt.SelectStmt.fromClause.filter(expr => expr.JoinExpr && expr.JoinExpr.jointype === 'JOIN_INNER');
    let lefts  = tree.RawStmt.stmt.SelectStmt.fromClause.filter(expr => expr.JoinExpr && expr.JoinExpr.jointype === 'JOIN_LEFT');

    let expressions = inners.map(expr => mapJoinExprs(expr.JoinExpr)).flat();
    let boolExprs   = expressions.filter(e => e.BoolExpr && e.BoolExpr.boolop === 'AND_EXPR');
    let leafs       = boolExprs.map(b => mapLeafExpressions(b.BoolExpr.args)).flat();

    expressions = expressions
        .filter(e => !e.BoolExpr || e.BoolExpr.boolop !== 'AND_EXPR')
        .concat(leafs);

    inners.forEach(setDummyQual);

    // TODO: implement check to see if left join table is referenced in where clause, but not a NULL check
    // may indicate should be left join or where clause should be in left join query

    return await findProblemsFromExpressions(tree, findRecordExpr, expressions);
}

function setDummyQual(expr) {
    expr.JoinExpr.quals = wrapEqualCondition(1, 1);

    if (expr.JoinExpr.larg.JoinExpr) {
        setDummyQual(expr.JoinExpr.larg);
    }

    if (expr.JoinExpr.rarg.JoinExpr) {
        setDummyQual(expr.JoinExpr.rarg);
    }
}

function mapJoinExprs(joinExpr) {
    let quals = [ joinExpr.quals ];

    if (joinExpr.larg.JoinExpr) {
        quals.push.apply(quals, mapJoinExprs(joinExpr.larg.JoinExpr));
    }

    if (joinExpr.rarg.JoinExpr) {
        quals.push.apply(quals, mapJoinExprs(joinExpr.rarg.JoinExpr));
    }

    return quals;
}

async function findProblemsFromExpressions(tree, findRecordExpr, expressions) {
    let problems    = [];
    let promises    = [];

    for (let i = 0; i < expressions.length; i++) {
        let expr = wrapBoolExpr('AND_EXPR', [
            findRecordExpr,
            expressions[i]
        ]);

        let promise = queryHasResultsWithWhereExpr(tree, expr, i)
            .then(({has_result, input}) => {
                if (!has_result) {
                    problems.push(expressions[input]);
                }
            });

        promises.push(promise);
    }

    await Promise.all(promises);

    return problems;
}

async function findWhereProblems(stmt, findRecordExpr) {
    let whereClause  = stmt.RawStmt.stmt.SelectStmt.whereClause;

    if (!whereClause) {
        // No where clause, so must not be a problem
        return [];
    }

    let tree      = clone(stmt);
    let joinExprs = tree.RawStmt.stmt.SelectStmt.fromClause.filter(expr => expr.JoinExpr);

    joinExprs.forEach(setDummyQual);

    if (!whereClause.BoolExpr || whereClause.BoolExpr.boolop !== 'AND_EXPR') {
        delete tree.RawStmt.stmt.SelectStmt.whereClause;

        let query  = deparse([tree]);
        let result = await client.query(query);

        return result.rowCount > 0 ? [whereClause] : [];
    }

    let expressions = mapLeafExpressions(whereClause.BoolExpr.args);

    return findProblemsFromExpressions(tree, findRecordExpr, expressions);
}

function mapLeafExpressions(andExprConditions) {
    let expressions = [];

    for (let i = andExprConditions.length - 1; i >= 0; i--) {
        let is_and_cond = andExprConditions[i].BoolExpr && andExprConditions[i].BoolExpr.boolop === 'AND_EXPR';

        if (is_and_cond) {
            expressions.push.apply(expressions, mapLeafExpressions(andExprConditions[i].BoolExpr.args));
        } else {
            expressions.push(andExprConditions[i]);
        }
    }

    return expressions;
}


async function queryHasResultsWithWhereExpr(tree, expr, input) {
    let test = clone(tree);

    test.RawStmt.stmt.SelectStmt.whereClause = expr;

    let query  = deparse([test]);
    let result = await client.query(query);

    return {
        input,
        has_result: result.rowCount > 0
    };
}

function createExprToFindRecord(table_alias, column, id) {
    return {
        A_Expr: {
            kind: 'AEXPR_OP',
            name: [ { String: { str: '=' } } ],
            lexpr: {
                ColumnRef: {
                    fields: [
                        wrapDataType(table_alias),
                        wrapDataType(column)
                    ]
                }
            },
            rexpr: wrapConst(id)
        }
    };
}

function wrapBoolExpr(operation, args) {
    return {
        BoolExpr: {
            boolop: operation,
            args: args
        }
    };
}

function wrapConst(value) {
    return {
        A_Const: {
            val: wrapDataType(value)
        }
    };
}

function wrapDataType(value) {
    switch(typeof value) {
        case 'string':
            return { String: { str: value } };
        case 'number':
            return { Integer: { ival: value } };
    }
}

function wrapEqualCondition(value1, value2) {
    return {
        A_Expr: {
            kind: 'AEXPR_OP',
            name: [ wrapDataType('=') ],
            lexpr: wrapConst(value1),
            rexpr: wrapConst(value2)
        }
    };
}

async function getFirstRow(query, values = undefined) {
    const resultset = await client.query(query, values);
    return resultset.rows[0];
}

async function getPrimaryColumn(table) {
    let row = await getFirstRow(`
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON (
            a.attrelid = i.indrelid
            AND a.attnum = ANY(i.indkey)
        )
        WHERE i.indrelid = '${table}'::regclass
        AND i.indisprimary;
    `);

    return row.attname;
}

function getRealQuery() {
    return `
    SELECT *
    FROM lister.owners o
    INNER JOIN lister.posts p ON p.owner_id = o.id AND 1 = 2
    INNER JOIN lister.platform_posts pp ON pp.post_id = p.id AND 3 = 1
    WHERE 3 = 2
    `;
}

function get1RealQuery() {
    return `SELECT
    *
    FROM
    "stories"
    LEFT JOIN "overrides" ON
    "stories"."id" = overrides.story_id
    AND overrides.pool_id = 5
    LEFT JOIN "owner_story" ON
    "stories"."id" = owner_story.story_id
    AND owner_story.owner_id = 17958
    WHERE
    "stories"."pool_id" = 5
    AND NOT EXISTS (
    SELECT
        *
    FROM
        "regions"
    INNER JOIN "region_story" ON
        "regions"."id" = "region_story"."region_id"
    WHERE
        "region_story"."story_id" = "stories"."id"
        AND "regions"."deleted_at" IS NULL)
    AND "stories"."id" IN (1283022)
    AND EXISTS (
    SELECT
        *
    FROM
        "platform_story"
    WHERE
        "story_id" = stories.id
        AND "platform_id" IN (1)
        AND "platform_id" = owner_story.platform_id
        AND "enabled" = true)
    AND ("expires_at" IS NULL
    OR "expires_at" > '2021-03-31 18:52:09')
    AND EXISTS (
    SELECT
        *
    FROM
        "classifier_story"
    WHERE
        "classifier_id" IN (1141, 1142)
        AND "story_id" = stories.id)
    AND EXISTS (
    SELECT
        *
    FROM
        "campaigns"
    INNER JOIN "campaign_story" ON
        "campaigns"."id" = "campaign_story"."campaign_id"
    WHERE
        "campaign_story"."story_id" = "stories"."id"
        AND "campaigns"."id" IN (283)
        AND "campaigns"."deleted_at" IS NULL)
    AND "owner_story"."platform_id" = 1
    AND (
        1 = 2
        AND 1=3
        AND ("owner_story"."type" IS NULL OR "owner_story"."deleted_at" IS NOT NULL)
    )
    AND "stories"."deleted_at" IS NULL
    ORDER BY
    "stories"."published_at" DESC,
    "stories"."id" DESC`;
}