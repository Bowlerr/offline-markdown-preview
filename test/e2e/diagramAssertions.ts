import { expect, type Locator } from '@playwright/test';

/** Verify the actual rendered connector and arrow, including exported SVG CSS. */
export async function expectReadableFlowchart(diagram: Locator): Promise<void> {
  const edge = diagram.locator('.flowchart-link').first();
  await expect(edge).toHaveCount(1);
  const colors = await edge.evaluate((element) => {
    const backgrounds: string[] = [];
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const color = getComputedStyle(ancestor).backgroundColor;
      if (color !== 'transparent') backgrounds.push(color);
    }
    return { edge: getComputedStyle(element).stroke, backgrounds };
  });
  const arrow = await diagram
    .locator('marker path')
    .first()
    .evaluate((element) => getComputedStyle(element).fill);
  type Rgb = [number, number, number];
  const composite = (color: string, background: Rgb): Rgb => {
    const channels = color.match(/[\d.]+/g)?.map(Number);
    const [red, green, blue, alpha = 1] = channels ?? [];
    if (
      !color.startsWith('rgb') ||
      red === undefined ||
      green === undefined ||
      blue === undefined
    )
      throw new Error(`Expected a resolved RGB color, received ${color}`);
    return [
      red * alpha + background[0] * (1 - alpha),
      green * alpha + background[1] * (1 - alpha),
      blue * alpha + background[2] * (1 - alpha)
    ];
  };
  const luminance = (channels: Rgb): number => {
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    // The RGB tuple guarantees all three channel values exist.
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  };
  // Composite translucent panels over their ancestors, then the white browser
  // canvas. Older VS Code palettes can supply rgba() panel tokens.
  const background = colors.backgrounds
    .reverse()
    .reduce<Rgb>(
      (underneath, color) => composite(color, underneath),
      [255, 255, 255]
    );
  const backgroundLuminance = luminance(background);
  for (const [part, color] of Object.entries({ edge: colors.edge, arrow })) {
    const foregroundLuminance = luminance(composite(color, background));
    const ratio =
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    expect(
      ratio,
      `Flowchart ${part} ${color} against composited rgb(${background.join(', ')}) needs at least 3:1 contrast`
    ).toBeGreaterThanOrEqual(3);
  }
}
