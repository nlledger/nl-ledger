import { fitText } from "./card-fit.mjs";
import { WORDMARK } from "./wordmark.mjs";
const element = (type, style, children) => ({
  type,
  props: { style, children },
});
const textBlock = (text, top, options, color = "white") => {
  const { size, lines } = fitText(text, options);
  return element(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      position: "absolute",
      left: 72,
      top,
      color,
      fontSize: size,
      lineHeight: 1.12,
    },
    lines.map((line) =>
      element("div", { display: "flex", height: size * 1.12 }, line),
    ),
  );
};
export function cardTree(c) {
  const logo = WORDMARK.replace(
    "<svg ",
    '<svg xmlns="http://www.w3.org/2000/svg" ',
  )
    .replace(/class="[^"]*"/, 'width="270" height="49"')
    .replace('fill="currentColor"', 'fill="white"');
  return element(
    "div",
    {
      display: "flex",
      position: "relative",
      width: 1200,
      height: 630,
      backgroundColor: "#1f3c96",
      fontFamily: "Archivo",
      fontWeight: 850,
    },
    [
      {
        type: "img",
        props: {
          src: `data:image/svg+xml;base64,${btoa(logo)}`,
          width: 270,
          height: 49,
          style: { position: "absolute", left: 72, top: 48 },
        },
      },
      textBlock(c.title, 132, {
        maxSize: c.figure ? 54 : 90,
        minSize: 28,
        maxLines: 3,
      }),
      textBlock(c.figure, 320, { maxSize: 116, minSize: 36, maxLines: 1 }),
      textBlock(
        c.label,
        462,
        { maxSize: 26, minSize: 22, maxLines: 3 },
        "#cdd7f5",
      ),
      element(
        "div",
        {
          position: "absolute",
          left: 72,
          right: 72,
          top: 552,
          height: 3,
          backgroundColor: "#cdd7f5",
        },
        "",
      ),
      element(
        "div",
        {
          position: "absolute",
          left: 72,
          right: 72,
          top: 560,
          height: 2,
          backgroundColor: "#cdd7f5",
        },
        "",
      ),
      textBlock("nlledger.ca", 578, { maxSize: 26, minSize: 26, maxLines: 1 }),
    ],
  );
}
