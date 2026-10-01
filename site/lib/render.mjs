import { experimental_AstroContainer } from "astro/container";

let registry;
// Node builds compile before rendering; the Worker bundles the same registry.
export async function renderComponent(name, props) {
  const components = await (registry ||= import("../.render/components.mjs"));
  // Request props and rendering state never cross requests.
  const container = await experimental_AstroContainer.create();
  return container.renderToString(components[name], {
    props,
    partial: !name.startsWith("layouts_"),
  });
}
