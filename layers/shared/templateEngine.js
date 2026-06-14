'use strict';

/**
 * round(value, step)
 *   step > 0  → nearest multiple of step  (round(67, 10) = 70)
 *   step = 1  → Math.round
 */
function round(value, step) {
  if (step <= 0) throw new Error(`round: step must be > 0, got ${step}`);
  return Math.round(value / step) * step;
}

/**
 * Evaluate one computedFields expression for the given context.
 * Supported ops: +, -, *, /, ^, round(x, step), parentheses, numeric literals,
 * and any identifier present in ctx.
 */
function evalExpr(expr, ctx) {
  // replace ^ with ** for exponentiation
  let src = expr.replace(/\^/g, '**');

  // inject context variables as const declarations
  const varDecls = Object.entries(ctx)
    .filter(([k]) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))
    .map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`)
    .join('\n');

  // eslint-disable-next-line no-new-func
  return new Function('round', `${varDecls}\nreturn (${src});`)(round);
}

/**
 * Replace {{token}} placeholders in a text template string.
 * Unknown tokens are left as-is.
 */
function renderText(template, ctx) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(ctx, key) ? ctx[key] : `{{${key}}}`
  );
}

/**
 * computeMasterData(questionnaire, template) → SizeRecord[]
 *
 * @param {object} questionnaire  - validated questionnaire (see input/questionnaire.schema.json)
 * @param {object} template       - contents of layers/shared/config/template.master.json
 * @returns {object[]}            - one record per size (XS–XL), ordered as template.sizes
 */
function computeMasterData(questionnaire, template) {
  const { moldName, article, brand, theme, color, priceBaseM, sizes: sizeRows } = questionnaire;
  const { baseSizeKey, computedFields, textTemplates, static: staticFields } = template;

  // index size rows by size key for O(1) lookup
  const sizeByKey = Object.fromEntries(sizeRows.map(r => [r.size, r]));

  const baseRow = sizeByKey[baseSizeKey];
  if (!baseRow) throw new Error(`Base size "${baseSizeKey}" not found in questionnaire.sizes`);
  const faceSizeM = baseRow.faceSize;

  return template.sizes.map(sizeKey => {
    const physicalRow = sizeByKey[sizeKey];
    if (!physicalRow) throw new Error(`Size "${sizeKey}" not found in questionnaire.sizes`);

    // base context: physical fields + questionnaire scalars
    const ctx = {
      ...physicalRow,
      moldName,
      article,
      brand,
      theme,
      color,
      priceBaseM,
      faceSizeM,
    };

    // evaluate computed fields in declaration order (weightPacked needs moldWeight, etc.)
    for (const [field, expr] of Object.entries(computedFields)) {
      ctx[field] = evalExpr(expr, ctx);
    }

    // render text templates
    const texts = {};
    for (const [field, tmpl] of Object.entries(textTemplates)) {
      texts[field] = renderText(tmpl, ctx);
    }

    return {
      ...physicalRow,
      moldName,
      article,
      brand,
      theme,
      color,
      priceBaseM,
      weightPacked:  ctx.weightPacked,
      priceBase:     ctx.priceBase,
      priceDiscount: ctx.priceDiscount,
      toyFrom:       ctx.toyFrom,
      toyTo:         ctx.toyTo,
      ...texts,
      ...staticFields,
    };
  });
}

module.exports = { computeMasterData, round, evalExpr, renderText };
