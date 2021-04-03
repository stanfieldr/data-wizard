function wrapBoolExpr(operation, args) {
  return {
    BoolExpr: {
      boolop: operation,
      args: args,
    },
  };
}

function wrapConst(value) {
  return {
    A_Const: {
      val: wrapDataType(value),
    },
  };
}

function wrapDataType(value) {
  switch (typeof value) {
    case "string":
      return { String: { str: value } };
    case "number":
      return { Integer: { ival: value } };
  }
}

function wrapEqualCondition(value1, value2) {
  return {
    A_Expr: {
      kind: "AEXPR_OP",
      name: [wrapDataType("=")],
      lexpr: wrapConst(value1),
      rexpr: wrapConst(value2),
    },
  };
}

module.exports = {
  wrapBoolExpr,
  wrapConst,
  wrapDataType,
  wrapEqualCondition
};