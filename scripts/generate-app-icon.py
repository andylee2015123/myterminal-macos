from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
SCALE = 4
CANVAS = SIZE * SCALE


def scaled(value: int) -> int:
    return value * SCALE


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def rounded_rect_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size)
    pixels = image.load()
    for y in range(height):
        t = y / max(height - 1, 1)
        color = tuple(lerp(top[i], bottom[i], t) for i in range(3)) + (255,)
        for x in range(width):
            pixels[x, y] = color
    return image


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, scaled(size))
        except OSError:
            continue
    return ImageFont.load_default()


def draw_icon() -> Image.Image:
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    icon_rect = (scaled(48), scaled(48), scaled(976), scaled(976))
    background = vertical_gradient((scaled(928), scaled(928)), (34, 50, 61), (11, 129, 117))
    bg_mask = rounded_rect_mask(background.size, scaled(214))
    image.paste(background, (scaled(48), scaled(48)), bg_mask)

    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(icon_rect, radius=scaled(214), outline=(255, 255, 255, 42), width=scaled(4))

    glow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((scaled(138), scaled(96), scaled(770), scaled(644)), fill=(96, 230, 205, 48))
    glow_draw.ellipse((scaled(486), scaled(462), scaled(1010), scaled(1030)), fill=(72, 148, 255, 38))
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(scaled(46))))

    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    terminal_rect = (scaled(176), scaled(248), scaled(848), scaled(752))
    shadow_draw.rounded_rectangle(terminal_rect, radius=scaled(54), fill=(0, 0, 0, 118))
    image.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(scaled(32))), (0, scaled(26)))

    draw.rounded_rectangle(terminal_rect, radius=scaled(54), fill=(13, 17, 23, 255))
    draw.rounded_rectangle(terminal_rect, radius=scaled(54), outline=(255, 255, 255, 50), width=scaled(4))

    titlebar = (terminal_rect[0], terminal_rect[1], terminal_rect[2], terminal_rect[1] + scaled(110))
    draw.rounded_rectangle(titlebar, radius=scaled(54), fill=(34, 42, 52, 255))
    draw.rectangle((titlebar[0], titlebar[3] - scaled(54), titlebar[2], titlebar[3]), fill=(34, 42, 52, 255))
    draw.line((terminal_rect[0], titlebar[3], terminal_rect[2], titlebar[3]), fill=(255, 255, 255, 26), width=scaled(3))

    dot_y = scaled(303)
    for x, color in [
        (scaled(238), (255, 95, 87, 255)),
        (scaled(294), (255, 189, 46, 255)),
        (scaled(350), (40, 201, 64, 255)),
    ]:
        draw.ellipse((x - scaled(15), dot_y - scaled(15), x + scaled(15), dot_y + scaled(15)), fill=color)

    terminal_font = font(162)
    text = ">_"
    bbox = draw.textbbox((0, 0), text, font=terminal_font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    text_x = scaled(512) - text_width // 2
    text_y = scaled(548) - text_height // 2 - scaled(14)
    draw.text((text_x, text_y), text, fill=(135, 245, 219, 255), font=terminal_font)

    highlight = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    highlight_draw = ImageDraw.Draw(highlight)
    highlight_draw.rounded_rectangle(
        (scaled(80), scaled(68), scaled(944), scaled(404)),
        radius=scaled(184),
        fill=(255, 255, 255, 28),
    )
    image.alpha_composite(highlight)

    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main() -> None:
    output = draw_icon()
    output.save(ROOT / "assets" / "app-icon.png")
    output.save(ROOT / "assets" / "app-icon-source.png")


if __name__ == "__main__":
    main()
