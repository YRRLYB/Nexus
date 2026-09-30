"""Render the supplied gemini-svg.svg logo into Windows assets (requires Pillow)."""
from pathlib import Path
import re
import shutil
from xml.etree import ElementTree
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
source = root / 'gemini-svg.svg'
document = ElementTree.parse(source).getroot()
namespace = {'svg': 'http://www.w3.org/2000/svg'}
group = document.find('svg:g', namespace)
offset = [float(value) for value in re.findall(r'[\d.]+', group.attrib['transform'])]
path = group.find('svg:path', namespace)
coordinates = [float(value) for value in re.findall(r'[\d.]+', path.attrib['d'])]
scale = 1024 / float(document.attrib['viewBox'].split()[2])
image = Image.new('RGBA', (1024, 1024))
draw = ImageDraw.Draw(image)
points = [
    ((horizontal + offset[0]) * scale, (vertical + offset[1]) * scale)
    for horizontal, vertical in zip(coordinates[::2], coordinates[1::2])
]
radius = float(path.attrib['stroke-width']) * scale / 2
draw.line(points, fill=path.attrib['stroke'], width=round(radius * 2), joint='curve')
for horizontal, vertical in points:
    draw.ellipse((horizontal - radius, vertical - radius, horizontal + radius, vertical + radius), fill=path.attrib['stroke'])
for circle in group.findall('svg:circle', namespace):
    horizontal = (float(circle.attrib['cx']) + offset[0]) * scale
    vertical = (float(circle.attrib['cy']) + offset[1]) * scale
    radius = float(circle.attrib['r']) * scale
    draw.ellipse((horizontal - radius, vertical - radius, horizontal + radius, vertical + radius), fill=circle.attrib['fill'])
image = image.resize((256, 256), Image.Resampling.LANCZOS)
image.save(root / 'assets' / 'icon.png')
image.save(root / 'assets' / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
shutil.copyfile(source, root / 'assets' / 'icon.svg')
