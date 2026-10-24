# Panel Cropper

A local React and FastAPI editor for turning script paragraphs into sequential, full-resolution image crops.

## Setup

```powershell
python -m pip install -r backend/requirements.txt
cd frontend
npm install
```

## Run

From the project root:

```powershell
.\start.ps1
```

The browser opens at `http://127.0.0.1:5173`. New projects use `C:\Users\Admin\Desktop\CBZ\images` by default, or you can choose another output folder in the launcher. The app creates a named project folder with `sources` and `crops` subfolders. Imported source files are never modified; exports are written to `crops`.

The Windows desktop and Start Menu shortcuts run `launch-app.ps1`: it starts either local server if needed, waits for both to be ready, and then opens the installed app. Repeated clicks reuse running servers. If Chrome reinstalls the app and replaces its shortcuts, run `install-desktop-shortcut.ps1` again.

## Source library

Use **Browse & read online** on the project launcher, or **Browse & read** in an open project, to search and read without manually downloading a CBZ. Panel Cropper supplies its own search, series details, chapter list, and scrolling reader. Suwayomi runs in the background as the source engine. **Connection** defaults to `http://127.0.0.1:4567` and accepts another server address and optional Basic authentication credentials. The connection is saved locally; its settings and page cache are excluded from version control. The default address can also be set with `PANEL_CROPPER_SUWAYOMI_URL` before starting the backend.

Search one installed source or all sources in the selected language (English by default), browse popular series, or open **My library**. Open a series to see its cover, description, author, genres, and filterable chapter list. Selecting a chapter automatically prepares its original pages, showing progress, then opens the entire chapter in the same continuous crop canvas used for CBZs. Pages meet edge to edge, with no page buttons or separators between them. Preparation can take a while the first time; reopening reuses the saved strip, and retries reuse pages already loaded.

Scroll the chapter, click a visible spot to move the crop frame there, adjust the frame, and use the existing **Save crop** button or **Ctrl+Enter**. Crops can span any number of page boundaries. Saving advances to the next crop or script paragraph while keeping the chapter, frame, and scroll position in place. Original pages stay in the project for offline editing and exporting. If no project is open, the cropper creates a project named after the series in the default output folder and starts **Without script** mode; an existing script project keeps its paragraphs and mode. **Chapters** above the canvas returns to the chapter list; the arrows beside it open the previous or next chapter in the same translation group. Browsing and reading do not change Suwayomi's read flags.

The launchers automatically start an existing sibling `Suwayomi-Server\server\build\Suwayomi-Server-*.jar` in the background for a local HTTP connection, without opening Suwayomi's browser interface. Set `PANEL_CROPPER_SUWAYOMI_DIR` if that checkout is elsewhere. If Java or a built server is unavailable, start your reader server manually. Online source installation and source-specific configuration still use your existing Suwayomi setup.

Use **Add folder** to import JPG, PNG, and WebP images from a folder and its subfolders. Each imported folder gets a tab. The app copies valid images into the project as a snapshot, so moving or deleting the original folder does not break saved crops. Readding the same folder selects its existing tab; it does not refresh or duplicate its images. Unsupported and unreadable files are skipped.

Use **Add files** or drop individual images into the source pane to add them to the project's **Project files** tab. This tab appears on the first individual import. Switching folder tabs filters the library without changing the current canvas image or crop. The tabs preserve folder order, and images sort naturally by filename or relative path.

Use **CBZ** to import a comic archive into its own tab. Supported pages include JPG, PNG, WebP, GIF, BMP, and AVIF (requires Pillow 11.3 or newer; rerun the setup install command when upgrading). Its pages appear as one continuous vertical strip in natural filename order, starting at the first page. Pages with different widths are scaled to the widest page while keeping their proportions. Scroll through the strip and crop anywhere, including across page boundaries. Nearby pages load as you scroll, and exports compose only the selected area. Saved script paragraphs show **Completed** instead of a source filename. The strip and its crop positions are saved with the project; the original CBZ is never modified.

Image rows show `Cropped for 003` for saved crops and `Assigned to 012` for unfinished paragraph assignments. Numbers follow the script's current order and update when paragraphs move. Hover or focus a `+N more` label to see the full list.

Each script line becomes a paragraph. Use the Script panel's **Import script** button to choose a `.txt` or `.md` file, or paste text or drop a file into the panel. Review the imported text and click **Apply script** to create paragraphs. You can drag paragraph headers to reorder them and download the edited script with the Script panel's export button. Unfinished paragraphs stay at the top of the queue; completed paragraphs appear below them. Clicking another paragraph keeps the current image and crop frame in place.

Click an image in the library, move the crop frame over the stationary image, and adjust its corners or the **Crop** slider. If the frame is out of view, click a visible spot on the image to move the frame there. The image opens at a 9:16 phone-width scale derived from the workspace size; long images scroll vertically. The separate **Panel** slider scales the preview from 5% to 800% of its initial size without changing the exported crop. Its percentage shows the displayed image size relative to the original pixels. The rotate button turns the image in 90° steps while the crop frame keeps its chosen orientation; **Save crop** writes the rotated result, and **Export all** uses each saved paragraph's rotation. The current preview and crop remain in place while you move through paragraphs; clicking a different image in the library selects a new one. Saving links the image to the paragraph automatically and advances to the first unfinished paragraph.

## Shortcuts

To crop without a script, choose **Crop mode → Without script** at the top of the right pane. Choose an image or CBZ strip and click **Save crop** (or **Ctrl+Enter**). Each save adds a numbered crop and starts the next one with the current frame in place. Select a saved crop to adjust and save it again. These crops export as `crops/free-001.png`, `free-002.png`, and so on, and are included in **Export all**. The mode and crop list are saved with your project. Switch back to **With script** to continue your script paragraphs.

| Shortcut | Action |
| --- | --- |
| `[` / `]` or `Left` / `Right` | Previous / next paragraph in the queue |
| `1`, `2`, `3`, `4` | Select 9:16, 4:5, 4:3, 1:1 |
| `Alt` + arrow keys | Move crop frame 10 pixels; add `Shift` for 50 pixels |
| `+`, `-`, `0` | Panel preview zoom in, out, fit width |
| `R` | Reset crop frame |
| `Ctrl+Enter` | Save crop and advance |
| `Ctrl+S` | Save project |
| `Ctrl+Shift+E` | Download edited script |
| `Delete` | Clear the selected image from the workspace |
| `?` | Show or hide the shortcut list |
