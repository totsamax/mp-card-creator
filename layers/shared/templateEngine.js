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
  const { moldName, article, brand, theme, color, priceBaseM, moldType, sizes: sizeRows, userTexts } = questionnaire;
  const { baseSizeKey, computedFields, textTemplates, static: staticFields } = template;

  // select type-specific config (topic/purpose/titleFull/annotation) with fallback to static/textTemplates
  const typeCfg = (template.moldTypes && moldType) ? template.moldTypes[moldType] : null;
  const titleFullTmpl = typeCfg ? typeCfg.titleFull : textTemplates.titleFull;
  const annotationTmpl = typeCfg ? typeCfg.annotation : textTemplates.annotation;
  const topic = typeCfg ? typeCfg.topic : staticFields.topic;
  const purpose = typeCfg ? typeCfg.purpose : staticFields.purpose;

  // index size rows by size key for O(1) lookup
  const sizeByKey = Object.fromEntries(sizeRows.map(r => [r.size, r]));

  const baseRow = sizeByKey[baseSizeKey];
  if (!baseRow) throw new Error(`Base size "${baseSizeKey}" not found in questionnaire.sizes`);
  const moldSizeM = baseRow.moldSize;

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
      moldSizeM,
    };

    // evaluate computed fields in declaration order (weightPacked needs moldWeight, etc.)
    // ReferenceError means a physical property is absent — keep existing ctx value (from physicalRow) or null.
    // NaN result means a numeric dependency was undefined — same: keep existing or null.
    for (const [field, expr] of Object.entries(computedFields)) {
      try {
        const val = evalExpr(expr, ctx);
        if (typeof val === 'number' && isNaN(val)) {
          // keep physicalRow value if already in ctx, otherwise null
          if (!Object.prototype.hasOwnProperty.call(ctx, field)) ctx[field] = null;
        } else {
          ctx[field] = val;
        }
      } catch (err) {
        if (err instanceof ReferenceError) {
          // keep physicalRow value if already in ctx, otherwise null
          if (!Object.prototype.hasOwnProperty.call(ctx, field)) ctx[field] = null;
        } else {
          throw err;
        }
      }
    }

    // render text templates — titleFull and annotation use type-specific templates
    const texts = {};
    for (const [field, tmpl] of Object.entries(textTemplates)) {
      if (field === 'titleFull') {
        texts[field] = renderText(titleFullTmpl, ctx);
      } else if (field === 'annotation') {
        texts[field] = renderText(annotationTmpl, ctx);
      } else {
        texts[field] = renderText(tmpl, ctx);
      }
    }

    return {
      ...physicalRow,
      moldName,
      article,
      brand,
      theme,
      color,
      priceBaseM,
      moldType,
      weightPacked:  ctx.weightPacked,
      priceBase:     ctx.priceBase,
      priceDiscount: ctx.priceDiscount,
      toyFrom:       ctx.toyFrom,
      toyTo:         ctx.toyTo,
      ...texts,
      ...staticFields,
      topic,
      purpose,
      userTexts:     userTexts || {},
    };
  });
}

module.exports = { computeMasterData, round, evalExpr, renderText };
