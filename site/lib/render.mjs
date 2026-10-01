import { experimental_AstroContainer } from "astro/container";
// Only JavaScript entry points render strings. Components import and nest directly.
export async function renderAstro(
  component,
  props,
  slots = {},
  partial = true,
) {
  const container = await experimental_AstroContainer.create();
  return container.renderToString(component, { props, slots, partial });
}
