from pathlib import Path
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
import json
from PIL import Image, ImageDraw
import urllib.request

root = Path(__file__).resolve().parent / "cbz-ui"
root.mkdir(exist_ok=True)
with ZipFile(root / "Preview sample.cbz", "w", ZIP_DEFLATED) as archive:
    for number in [10, 2, 1, 3, 4, 5, 6, 7, 8, 9, 11, 12]:
        size = (800, 1200) if number != 2 else (400, 600)
        page = Image.new("RGB", size, ["#314662", "#8c5454", "#407258"][(number - 1) % 3])
        draw = ImageDraw.Draw(page)
        draw.text((40, 60), f"PAGE {number}", fill="white", font_size=60 if number != 2 else 30)
        draw.rectangle((20, 20, size[0] - 20, size[1] - 20), outline="white", width=3)
        data = BytesIO()
        page.save(data, format="PNG")
        archive.writestr(f"{number}.png", data.getvalue())
body = json.dumps({"projectName": "CBZ preview check", "outputFolder": str(root)}).encode()
request = urllib.request.Request("http://127.0.0.1:8000/api/projects", data=body,
                                 headers={"Content-Type": "application/json"})
project = json.load(urllib.request.urlopen(request))
(root / "fixture.json").write_text(json.dumps(project), encoding="utf-8")
print(json.dumps({"id": project["id"], "folder": project["outputFolder"], "archive": str(root / "Preview sample.cbz")}))
