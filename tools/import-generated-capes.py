"""Pack PixelLab static/animated PNGs into PixelHeroes Cape sheets (Pillow)."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'custom-assets' / 'capes'
DEST = ROOT / 'assets' / 'pixelheroes'
DESIGNS = json.loads((ROOT / 'tools' / 'cape-designs.json').read_text(encoding='utf-8'))
DESIGNS += json.loads((ROOT / 'tools' / 'cape-designs-v2.json').read_text(encoding='utf-8'))
DESIGNS += json.loads((ROOT / 'tools' / 'cape-designs-v3.json').read_text(encoding='utf-8'))
LAYOUT = json.loads((ROOT / 'tools' / 'cape-layout.json').read_text(encoding='utf-8'))
# Dimensions and top position selected against Human's shoulder at y=48.
PLACEMENT = {
    'PixelLabAngel': (32, 18, 40),
    'PixelLabBat': (34, 20, 37),
    'PixelLabButterfly': (32, 26, 34),
    'PixelLabFlame': (36, 25, 34),
    'PixelLabFrost': (34, 25, 30),
}
ROWS = [(32, 2), (96, 2), (160, 4), (224, 4), (352, 3),
        (480, 3), (544, 4), (608, 4), (736, 2), (800, 3), (864, 9)]

manifest_path = DEST / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
retired = {'PixelLabRoyal', 'PixelLabOctoArms'}
manifest['layers']['Cape'] = [name for name in manifest['layers']['Cape'] if name not in retired]
for name in retired:
    retired_sheet = (DEST / 'Cape' / f'{name}.png').resolve()
    assert retired_sheet.parent == (DEST / 'Cape').resolve()
    retired_sheet.unlink(missing_ok=True)
for design in DESIGNS:
    name = design['id']
    if '--available' in sys.argv and not (SOURCE / f'{name}.png').exists():
        print(f'{name}: still generating, skipped for intermediate preview')
        continue
    original = Image.open(SOURCE / f'{name}.png').convert('RGBA')
    if 'sourceFrame' in design:
        original = Image.open(SOURCE / name / f'frame-{design["sourceFrame"]:02}.png').convert('RGBA')
    sources = [original]
    if design.get('animated'):
        sources = [Image.open(SOURCE / name / f'frame-{i:02}.png').convert('RGBA') for i in range(8)]
        if len({image.tobytes() for image in sources}) < 4:
            raise ValueError(f'{name}: expected at least four distinct animation frames')
        if any(image.size != sources[0].size for image in sources):
            raise ValueError(f'{name}: animation frame canvases must match')
    bounds = original.getbbox()
    if not bounds or original.getextrema()[3][0] != 0:
        raise ValueError(f'{name}: expected nonempty transparent PNG')
    width, height, top = PLACEMENT[name] if name in PLACEMENT else (design['width'], design['height'], design['top'])
    if design.get('animated'):
        boxes = [image.getbbox() for image in sources]
        if any(box is None for box in boxes):
            raise ValueError(f'{name}: blank animation frame')
        # A common crop and scale prevent per-frame resizing/anchor jitter.
        bounds = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    if not (0 < width <= 62 and 0 <= top and top + height < 64):
        raise ValueError(f'{name}: sprite touches/outside frame boundary')
    frames = []
    for source in sources:
        sprite = source.crop(bounds).resize((width, height), Image.Resampling.NEAREST)
        frame = Image.new('RGBA', (64, 64))
        frame.alpha_composite(sprite, ((64 - width) // 2, top))
        frames.append(frame)
    frame = frames[0]
    # Native cells append after the legacy rows; extra padding permits lateral
    # attachment adjustments without clipping or resampling the source pixels.
    cell = LAYOUT[name].get('cell', 128)
    assert cell in (128, 144)
    body_offset = (cell - 64) // 2
    sheet = Image.new('RGBA', (cell * 8, 992 + cell))
    icon = original.crop(bounds)
    if LAYOUT[name].get('flip'):
        icon = ImageOps.mirror(icon)
    icon.thumbnail((30, 30), Image.Resampling.NEAREST)
    sheet.alpha_composite(icon, ((32 - icon.width) // 2, (32 - icon.height) // 2))
    for row, count in ROWS:
        for column in range(count):
            sheet.alpha_composite(frame, (column * 64, row))
    if design.get('animated'):
        for i, animation_frame in enumerate(frames):
            sheet.alpha_composite(animation_frame, (i * 64, 928))
    layout = LAYOUT[name]
    native_frames = []
    for source in sources:
        ax, ay = layout['anchor']
        native = source
        if layout.get('flip'):
            native = ImageOps.mirror(native)
            ax = source.width - 1 - ax
        scale = layout.get('scale', 1)
        if scale != 1:
            # Small hovering devices are the explicit exception: exact 2:1 reduction.
            assert scale == 0.5
            native = native.resize((source.width // 2, source.height // 2), Image.Resampling.NEAREST)
        tx, ty = layout['target']
        ox, oy = body_offset + tx - round(ax * scale), body_offset + ty - round(ay * scale)
        box = native.getbbox()
        assert box and 0 <= ox + box[0] and ox + box[2] <= cell and 0 <= oy + box[1] and oy + box[3] <= cell, (name, box, ox, oy)
        large = Image.new('RGBA', (cell, cell))
        large.alpha_composite(native, (ox, oy))
        native_frames.append(large)
    for i, large in enumerate(native_frames):
        sheet.alpha_composite(large, (i * cell, 992))
    # Explicit frame count: retained item IDs may end in Animated but now be static.
    sheet.putpixel((0, 960), (len(native_frames), cell, 1, 255))
    native_frames[0].save(SOURCE / f'{name}-placed.png')
    if design.get('animated'):
        native_frames[0].save(SOURCE / f'{name}.gif', save_all=True, append_images=native_frames[1:], duration=125, loop=0, disposal=2)
    elif 'sourceFrame' in design:
        native_frames[0].save(SOURCE / f'{name}.gif')
    sheet.save(DEST / 'Cape' / f'{name}.png')
    if name not in manifest['layers']['Cape']:
        manifest['layers']['Cape'].append(name)
    # Assert every animation frame carries the exact same static accessory.
    for row, count in ROWS:
        for column in range(count):
            assert sheet.crop((column * 64, row, column * 64 + 64, row + 64)).tobytes() == frame.tobytes()
    print(f'{name}: source {sources[0].width}x{sources[0].height}, scale={layout.get("scale", 1)}, anchor={layout["anchor"]}, {len(native_frames)} native frame(s)')
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
