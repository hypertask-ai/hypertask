export function collectAiChatToolNames(
  typescript,
  sourceText,
  fileName = "route.ts",
) {
  const sourceFile = typescript.createSourceFile(
    fileName,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const toolObjects = [];
  let toolDeclaration;
  let buildToolsFunction;

  function visit(node) {
    if (
      typescript.isFunctionDeclaration(node) &&
      node.name?.text === "buildTools"
    ) {
      if (buildToolsFunction) {
        throw new Error("Expected exactly one buildTools function");
      }
      buildToolsFunction = node;
    }
    if (
      typescript.isVariableDeclaration(node) &&
      typescript.isIdentifier(node.name) &&
      node.name.text === "tools" &&
      node.type?.getText(sourceFile) === "ToolSet" &&
      node.initializer &&
      typescript.isObjectLiteralExpression(node.initializer)
    ) {
      toolObjects.push(node.initializer);
      toolDeclaration = node;
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (toolObjects.length !== 1) {
    throw new Error(
      `Expected exactly one direct const tools: ToolSet object, found ${toolObjects.length}`,
    );
  }
  if (!buildToolsFunction?.body) {
    throw new Error("AI Chat ToolSet must be declared by buildTools");
  }

  let owner = toolDeclaration;
  while (owner && owner !== buildToolsFunction) owner = owner.parent;
  if (owner !== buildToolsFunction) {
    throw new Error("AI Chat ToolSet must be declared by buildTools");
  }

  const declarationStatement = toolDeclaration.parent.parent;
  const containingBlock = declarationStatement.parent;
  const statementIndex =
    containingBlock.statements?.indexOf(declarationStatement) ?? -1;
  const sealStatement = containingBlock.statements?.[statementIndex + 1];
  const sealCall =
    sealStatement && typescript.isExpressionStatement(sealStatement)
      ? sealStatement.expression
      : null;
  if (
    !sealCall ||
    !typescript.isCallExpression(sealCall) ||
    !typescript.isPropertyAccessExpression(sealCall.expression) ||
    !typescript.isIdentifier(sealCall.expression.expression) ||
    sealCall.expression.expression.text !== "Object" ||
    sealCall.expression.name.text !== "seal" ||
    sealCall.arguments.length !== 1 ||
    !typescript.isIdentifier(sealCall.arguments[0]) ||
    sealCall.arguments[0].text !== "tools"
  ) {
    throw new Error(
      "AI Chat ToolSet must be sealed immediately after initialization",
    );
  }

  const assignmentKinds = new Set([
    typescript.SyntaxKind.EqualsToken,
    typescript.SyntaxKind.PlusEqualsToken,
    typescript.SyntaxKind.MinusEqualsToken,
    typescript.SyntaxKind.AsteriskEqualsToken,
    typescript.SyntaxKind.AsteriskAsteriskEqualsToken,
    typescript.SyntaxKind.SlashEqualsToken,
    typescript.SyntaxKind.PercentEqualsToken,
    typescript.SyntaxKind.LessThanLessThanEqualsToken,
    typescript.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    typescript.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    typescript.SyntaxKind.AmpersandEqualsToken,
    typescript.SyntaxKind.BarEqualsToken,
    typescript.SyntaxKind.CaretEqualsToken,
    typescript.SyntaxKind.BarBarEqualsToken,
    typescript.SyntaxKind.AmpersandAmpersandEqualsToken,
    typescript.SyntaxKind.QuestionQuestionEqualsToken,
  ]);
  const referencesTools = (node) => {
    if (typescript.isIdentifier(node)) return node.text === "tools";
    if (
      typescript.isPropertyAccessExpression(node) ||
      typescript.isElementAccessExpression(node)
    ) {
      return referencesTools(node.expression);
    }
    if (typescript.isParenthesizedExpression(node))
      return referencesTools(node.expression);
    return false;
  };
  const mutationApis = new Set([
    "Object.assign",
    "Object.defineProperty",
    "Object.defineProperties",
    "Object.setPrototypeOf",
    "Reflect.set",
    "Reflect.deleteProperty",
    "Reflect.defineProperty",
  ]);
  const apiName = (expression) =>
    typescript.isPropertyAccessExpression(expression) &&
    typescript.isIdentifier(expression.expression)
      ? `${expression.expression.text}.${expression.name.text}`
      : null;

  function rejectPostInitializationMutations(node) {
    if (node === toolDeclaration) return;
    if (
      typescript.isBinaryExpression(node) &&
      assignmentKinds.has(node.operatorToken.kind) &&
      referencesTools(node.left)
    ) {
      throw new Error("AI Chat ToolSet is mutated after initialization");
    }
    if (
      (typescript.isPrefixUnaryExpression(node) ||
        typescript.isPostfixUnaryExpression(node)) &&
      referencesTools(node.operand)
    ) {
      throw new Error("AI Chat ToolSet is mutated after initialization");
    }
    if (
      typescript.isDeleteExpression(node) &&
      referencesTools(node.expression)
    ) {
      throw new Error("AI Chat ToolSet is mutated after initialization");
    }
    if (
      typescript.isCallExpression(node) &&
      mutationApis.has(apiName(node.expression)) &&
      node.arguments[0] &&
      referencesTools(node.arguments[0])
    ) {
      throw new Error("AI Chat ToolSet is mutated after initialization");
    }
    typescript.forEachChild(node, rejectPostInitializationMutations);
  }
  rejectPostInitializationMutations(sourceFile);

  const returns = [];
  function collectBuildToolsReturns(node) {
    if (node !== buildToolsFunction && typescript.isFunctionLike(node)) return;
    if (typescript.isReturnStatement(node)) returns.push(node);
    typescript.forEachChild(node, collectBuildToolsReturns);
  }
  collectBuildToolsReturns(buildToolsFunction.body);
  const returnsRuntimeTools = (statement) => {
    const expression = statement.expression;
    if (typescript.isIdentifier(expression) && expression.text === "tools") {
      return true;
    }
    return Boolean(
      expression &&
        typescript.isCallExpression(expression) &&
        typescript.isIdentifier(expression.expression) &&
        expression.expression.text === "trackToolSetExecutions" &&
        expression.arguments.length > 0 &&
        typescript.isIdentifier(expression.arguments[0]) &&
        expression.arguments[0].text === "tools",
    );
  };
  if (returns.length !== 1 || !returnsRuntimeTools(returns[0])) {
    throw new Error(
      "buildTools must return the sealed tools catalog through the canonical runtime path",
    );
  }

  const names = [];
  for (const property of toolObjects[0].properties) {
    if (typescript.isSpreadAssignment(property)) {
      throw new Error(
        "AI Chat ToolSet uses a spread assignment; enumerate every tool directly so parity fails closed",
      );
    }
    if (!property.name || typescript.isComputedPropertyName(property.name)) {
      throw new Error(
        "AI Chat ToolSet contains an unsupported computed or unnamed property",
      );
    }

    const name =
      typescript.isIdentifier(property.name) ||
      typescript.isStringLiteral(property.name) ||
      typescript.isNumericLiteral(property.name)
        ? property.name.text
        : null;
    if (name === null) {
      throw new Error("AI Chat ToolSet contains an unsupported property name");
    }
    names.push(name);
  }

  if (new Set(names).size !== names.length) {
    throw new Error("AI Chat ToolSet contains a duplicate tool name");
  }
  return names.sort();
}

export function collectApiRouteMethods(
  typescript,
  sourceText,
  fileName = "route.ts",
) {
  const sourceFile = typescript.createSourceFile(
    fileName,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  const methods = new Set();
  const isExported = (node) =>
    node.modifiers?.some(
      (modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword,
    );

  for (const statement of sourceFile.statements) {
    if (typescript.isFunctionDeclaration(statement) && isExported(statement)) {
      if (statement.name && allowedMethods.has(statement.name.text)) {
        methods.add(statement.name.text);
      }
      continue;
    }
    if (typescript.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          typescript.isIdentifier(declaration.name) &&
          allowedMethods.has(declaration.name.text)
        ) {
          methods.add(declaration.name.text);
        }
      }
      continue;
    }
    if (
      typescript.isExportDeclaration(statement) &&
      statement.exportClause &&
      typescript.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (allowedMethods.has(element.name.text)) methods.add(element.name.text);
      }
    }
  }

  return [...methods].sort();
}

export function collectMcpRegistryVariables(
  typescript,
  sourceText,
  fileName = "index.ts",
) {
  const sourceFile = typescript.createSourceFile(
    fileName,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const registries = [];
  const imports = new Map();

  function visit(node) {
    if (
      typescript.isImportDeclaration(node) &&
      typescript.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.namedBindings &&
      typescript.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const item of node.importClause.namedBindings.elements) {
        imports.set(item.name.text, node.moduleSpecifier.text);
      }
    }
    if (
      typescript.isVariableDeclaration(node) &&
      typescript.isIdentifier(node.name) &&
      node.name.text === "MCP_TOOLS" &&
      node.initializer &&
      typescript.isArrayLiteralExpression(node.initializer)
    ) {
      registries.push(node.initializer);
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (registries.length !== 1) {
    throw new Error(
      `Expected exactly one direct MCP_TOOLS array, found ${registries.length}`,
    );
  }

  const declaration = registries[0].parent;
  const declarationList = declaration.parent;
  const declarationStatement = declarationList.parent;
  const isConst = Boolean(declarationList.flags & typescript.NodeFlags.Const);
  const isExported = declarationStatement.modifiers?.some(
    (modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword,
  );
  const containingBlock = declarationStatement.parent;
  const statementIndex =
    containingBlock.statements?.indexOf(declarationStatement) ?? -1;
  const freezeStatement = containingBlock.statements?.[statementIndex + 1];
  const freezeCall =
    freezeStatement && typescript.isExpressionStatement(freezeStatement)
      ? freezeStatement.expression
      : null;
  if (
    !isConst ||
    !isExported ||
    !freezeCall ||
    !typescript.isCallExpression(freezeCall) ||
    !typescript.isPropertyAccessExpression(freezeCall.expression) ||
    !typescript.isIdentifier(freezeCall.expression.expression) ||
    freezeCall.expression.expression.text !== "Object" ||
    freezeCall.expression.name.text !== "freeze" ||
    freezeCall.arguments.length !== 1 ||
    !typescript.isIdentifier(freezeCall.arguments[0]) ||
    freezeCall.arguments[0].text !== "MCP_TOOLS"
  ) {
    throw new Error(
      "MCP_TOOLS must be an exported const frozen immediately after initialization",
    );
  }

  return registries[0].elements.map((element) => {
    if (typescript.isSpreadElement(element)) {
      throw new Error(
        "MCP_TOOLS uses a spread; enumerate every tool so parity fails closed",
      );
    }
    if (!typescript.isIdentifier(element)) {
      throw new Error("MCP_TOOLS contains an unsupported non-identifier entry");
    }
    const importedFrom = imports.get(element.text);
    if (!importedFrom?.startsWith("./")) {
      throw new Error(`No local tool import found for ${element.text}`);
    }
    return { variable: element.text, importedFrom };
  });
}

export function collectHyperAiToolNames(
  typescript,
  sourceText,
  canonicalMcpNames,
  fileName = "hyperAiTools.ts",
) {
  const sourceFile = typescript.createSourceFile(
    fileName,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const fromEntriesCalls = [];
  const canonicalImports = [];
  const shadowDeclarations = [];
  const unwrap = (node) => {
    let current = node;
    while (
      typescript.isParenthesizedExpression(current) ||
      typescript.isAsExpression(current) ||
      typescript.isTypeAssertionExpression(current) ||
      typescript.isNonNullExpression(current)
    )
      current = current.expression;
    return current;
  };

  function visit(node) {
    if (
      typescript.isImportDeclaration(node) &&
      typescript.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "@/lib/mcp-server/tools" &&
      node.importClause?.namedBindings &&
      typescript.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const item of node.importClause.namedBindings.elements) {
        if (
          item.name.text === "MCP_TOOLS" &&
          (item.propertyName?.text ?? item.name.text) === "MCP_TOOLS"
        ) {
          canonicalImports.push(item);
        }
      }
    }
    if (
      ((typescript.isVariableDeclaration(node) ||
        typescript.isParameter(node) ||
        typescript.isFunctionDeclaration(node) ||
        typescript.isClassDeclaration(node)) &&
        node.name &&
        typescript.isIdentifier(node.name) &&
        node.name.text === "MCP_TOOLS")
    ) {
      shadowDeclarations.push(node);
    }
    if (
      typescript.isCallExpression(node) &&
      typescript.isPropertyAccessExpression(node.expression) &&
      typescript.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Object" &&
      node.expression.name.text === "fromEntries"
    )
      fromEntriesCalls.push(node);
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (canonicalImports.length !== 1 || shadowDeclarations.length !== 0) {
    throw new Error(
      "HyperAI MCP_TOOLS must resolve to the canonical named import from @/lib/mcp-server/tools",
    );
  }
  const canonicalCalls = fromEntriesCalls.filter((call) => {
    const mapping = unwrap(call.arguments[0]);
    const receiver =
      typescript.isCallExpression(mapping) &&
      typescript.isPropertyAccessExpression(mapping.expression) &&
      mapping.expression.name.text === "map"
        ? unwrap(mapping.expression.expression)
        : null;
    return typescript.isIdentifier(receiver) && receiver.text === "MCP_TOOLS";
  });
  if (canonicalCalls.length !== 1) {
    throw new Error(
      "HyperAI must map the canonical MCP_TOOLS registry directly",
    );
  }
  const [call] = canonicalCalls;
  const mapping = unwrap(call.arguments[0]);
  const callback = mapping.arguments[0];
  if (
    !callback ||
    (!typescript.isArrowFunction(callback) &&
      !typescript.isFunctionExpression(callback)) ||
    callback.parameters.length !== 1 ||
    !typescript.isIdentifier(callback.parameters[0].name) ||
    !typescript.isBlock(callback.body)
  ) {
    throw new Error(
      "HyperAI MCP adapter must use one explicit mapping callback",
    );
  }
  const parameterName = callback.parameters[0].name.text;
  const returnStatement = callback.body.statements.at(-1);
  const pair =
    returnStatement && typescript.isReturnStatement(returnStatement)
      ? unwrap(returnStatement.expression)
      : null;
  const firstEntry =
    pair && typescript.isArrayLiteralExpression(pair) ? pair.elements[0] : null;
  if (
    !pair ||
    !typescript.isArrayLiteralExpression(pair) ||
    pair.elements.length !== 2 ||
    !firstEntry ||
    !typescript.isPropertyAccessExpression(firstEntry) ||
    !typescript.isIdentifier(firstEntry.expression) ||
    firstEntry.expression.text !== parameterName ||
    firstEntry.name.text !== "name"
  ) {
    throw new Error(
      "HyperAI MCP adapter must return each canonical mcpTool.name unchanged",
    );
  }

  const callbackReturns = [];
  function collectCallbackReturns(node) {
    if (node !== callback.body && typescript.isFunctionLike(node)) return;
    if (typescript.isReturnStatement(node)) callbackReturns.push(node);
    typescript.forEachChild(node, collectCallbackReturns);
  }
  collectCallbackReturns(callback.body);
  if (callbackReturns.length !== 1 || callbackReturns[0] !== returnStatement) {
    throw new Error(
      "HyperAI MCP adapter must have one unconditional canonical return",
    );
  }

  function rejectCanonicalNameMutation(node) {
    if (
      typescript.isBinaryExpression(node) &&
      node.operatorToken.kind === typescript.SyntaxKind.EqualsToken &&
      typescript.isPropertyAccessExpression(node.left) &&
      typescript.isIdentifier(node.left.expression) &&
      node.left.expression.text === parameterName &&
      node.left.name.text === "name"
    ) {
      throw new Error("HyperAI MCP adapter cannot mutate canonical tool names");
    }
    typescript.forEachChild(node, rejectCanonicalNameMutation);
  }
  rejectCanonicalNameMutation(callback.body);
  if (
    !typescript.isReturnStatement(call.parent) ||
    call.parent.expression !== call
  ) {
    throw new Error("HyperAI canonical MCP mapping must be returned directly");
  }

  return [...canonicalMcpNames].sort();
}

export function assertHyperAiCanonicalRegistry(
  typescript,
  sourceText,
  fileName = "hyperAiTools.ts",
) {
  collectHyperAiToolNames(typescript, sourceText, [], fileName);
}
