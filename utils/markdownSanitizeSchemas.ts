import { defaultSchema, type Schema } from 'hast-util-sanitize';

/**
 * Named sanitize presets for MarkdownPreview (allowHtml="sanitized").
 * Extend here when adding new screens; wire via sanitizePreset prop.
 */
export type SanitizePreset = 'welcome' | 'minimal';

const mergeAttributes = (
  base: Schema['attributes'],
  extra: Record<string, Array<string | [string, ...unknown[]]>>
): Schema['attributes'] => ({
  ...base,
  ...Object.fromEntries(
    Object.entries(extra).map(([tag, attrs]) => {
      const existing = base?.[tag];
      const merged = Array.isArray(existing) ? [...existing] : [];
      for (const a of attrs) {
        if (!merged.includes(a)) merged.push(a);
      }
      return [tag, merged];
    })
  ),
});

/** Instructor Welcome: layout HTML (floated logo), standard doc structure, in-app hash links. */
export const welcomeSanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: mergeAttributes(defaultSchema.attributes ?? {}, {
    '*': ['className'],
    img: ['className', 'width', 'height'],
    a: ['className'],
    div: ['className'],
    span: ['className'],
  }),
};

/** Tighter preset for future use (no layout divs). */
export const minimalSanitizeSchema: Schema = {
  ...defaultSchema,
};

const PRESETS: Record<SanitizePreset, Schema> = {
  welcome: welcomeSanitizeSchema,
  minimal: minimalSanitizeSchema,
};

export function getSanitizeSchema(preset: SanitizePreset): Schema {
  return PRESETS[preset];
}
