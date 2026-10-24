# Panel Cropper — Implementation Plan

## 1. Project Goal

Build a local desktop-style panel cropping application with a web-based frontend UI.

The app should allow the user to:

- Drag multiple source images into the app.
- Paste or load a script.
- Treat each script paragraph as one output image slot.
- Edit the script inside the app.
- Assign any source image to any paragraph.
- Reuse the same source image multiple times.
- Crop the same image differently for different paragraphs.
- Use aspect ratios:
  - 9:16
  - 4:5
  - 4:3
  - 1:1
- Default every new crop to 9:16.
- Save cropped images directly to a designated output folder.
- Automatically create a project subfolder.
- Automatically name unnamed projects as:
  - Project 1
  - Project 2
  - Project 3
  - etc.
- Automatically increment duplicate project names instead of overwriting them.

---

## 2. Recommended Technology Stack

### Frontend

- React
- Vite
- TypeScript
- Tailwind CSS
- Zustand for application state
- react-dropzone for drag-and-drop image import
- react-easy-crop or a custom canvas cropper
- dnd-kit for paragraph reordering

### Backend

- Python
- FastAPI
- Pillow for image cropping and export
- JSON for project metadata
- Local filesystem access for projects and output files

### Desktop Wrapper

Recommended:

- Tauri

Alternative:

- Electron

Recommended architecture:

```text
Tauri Desktop App
        |
        +-- React + TypeScript Frontend
        |
        +-- Local FastAPI Backend
                |
                +-- Pillow
                +-- Project Manager
                +-- File Manager
                +-- Crop Exporter
```

---

## 3. Core Workflow

```text
Create/Open Project
        |
        v
Choose Output Folder
        |
        v
Drag Source Images
        |
        v
Paste/Edit Script
        |
        v
Split Script by Paragraph
        |
        v
Select Paragraph
        |
        v
Assign/Reassign Source Image
        |
        v
Choose Aspect Ratio
        |
        v
Crop Image
        |
        v
Save & Next
        |
        v
Automatically Save Crop
        |
        v
Move to Next Paragraph
```

Each script paragraph represents one output image.

Example script:

```text
He suddenly wakes up inside another person's body.

But the original owner had already made countless enemies.

Now he decides to repay him by eliminating every one of them.
```

The application interprets this as:

```text
Paragraph 1 -> 001.png
Paragraph 2 -> 002.png
Paragraph 3 -> 003.png
```

---

## 4. Main UI Layout

```text
+---------------------------------------------------------------------+
| Panel Cropper                                                       |
| Project: [My Project]  Output: [D:\Panel Crops]  [Save] [Settings] |
+------------------+------------------------------+-------------------+
| IMAGE LIBRARY    |                              | SCRIPT            |
|                  |                              |                   |
| [thumbnail]      |       CROP WORKSPACE         | 001 [complete]    |
| page_001.jpg     |                              | Paragraph text... |
|                  |                              |                   |
| [thumbnail]      |                              | 002 [assigned]    |
| page_002.jpg     |                              | Paragraph text... |
|                  |                              |                   |
| [thumbnail]      |                              | 003 [empty]       |
| page_003.jpg     |                              | Paragraph text... |
+------------------+------------------------------+-------------------+
| [9:16] [4:5] [4:3] [1:1]  Reset  Previous  Save  Save & Next       |
+---------------------------------------------------------------------+
```

The crop workspace should occupy the largest area.

---

## 5. Frontend Structure

```text
frontend/
├── src/
│   ├── components/
│   │   ├── ProjectHeader.tsx
│   │   ├── ImageLibrary.tsx
│   │   ├── ImageThumbnail.tsx
│   │   ├── CropWorkspace.tsx
│   │   ├── AspectRatioSelector.tsx
│   │   ├── ScriptPanel.tsx
│   │   ├── ParagraphCard.tsx
│   │   ├── BottomControls.tsx
│   │   └── OutputFolderPicker.tsx
│   │
│   ├── stores/
│   │   └── projectStore.ts
│   │
│   ├── services/
│   │   └── api.ts
│   │
│   ├── types/
│   │   ├── project.ts
│   │   ├── paragraph.ts
│   │   └── image.ts
│   │
│   ├── utils/
│   │   ├── scriptParser.ts
│   │   └── aspectRatios.ts
│   │
│   ├── App.tsx
│   └── main.tsx
```

---

## 6. Backend Structure

```text
backend/
├── main.py
│
├── api/
│   ├── projects.py
│   ├── images.py
│   ├── script.py
│   └── crops.py
│
├── services/
│   ├── project_manager.py
│   ├── image_manager.py
│   ├── crop_service.py
│   ├── script_service.py
│   └── file_service.py
│
├── models/
│   ├── project.py
│   ├── paragraph.py
│   └── image.py
│
└── utils/
    └── naming.py
```

---

## 7. Image Import

The user should be able to drag images directly into the application.

Supported formats:

```text
.jpg
.jpeg
.png
.webp
```

Dropped images appear in the image library.

Example:

```text
Source Images

[thumbnail] page_001.jpg
[thumbnail] page_002.jpg
[thumbnail] page_003.jpg
[thumbnail] page_004.jpg
```

Dropping additional files should append them to the existing library.

Source images must never be modified.

---

## 8. Image Reuse

The same source image may be used by unlimited paragraphs.

Example:

```text
page_025.jpg

Paragraph 3 -> face crop
Paragraph 4 -> full body crop
Paragraph 8 -> background crop
Paragraph 12 -> another close-up
```

Only one source image record is required.

Example:

```text
Image ID: img-25
Path: D:\Chapter 1\025.jpg
```

Paragraphs reference that image by ID.

```text
Paragraph 3 -> img-25
Paragraph 4 -> img-25
Paragraph 8 -> img-25
```

Each paragraph stores its own crop coordinates.

---

## 9. Script System

The script editor should accept pasted text.

Blank lines separate paragraphs.

Example:

```text
This hunter was considered completely useless.

But everything changed when he obtained a mysterious ability.

That ability allowed him to return to the past.
```

Parsed result:

```text
001 This hunter was considered completely useless.

002 But everything changed when he obtained a mysterious ability.

003 That ability allowed him to return to the past.
```

Each paragraph becomes an independent crop slot.

---

## 10. Script Editing

The user should be able to:

- Edit paragraph text.
- Add paragraphs.
- Delete paragraphs.
- Split a paragraph.
- Merge paragraphs.
- Reorder paragraphs.

Existing crop assignments should remain whenever possible.

Paragraphs should use persistent IDs instead of depending only on their current position.

Example:

```text
Paragraph ID: p17
```

If `p17` moves from position 5 to position 8, it should keep:

- Source image
- Crop coordinates
- Aspect ratio
- Completion state

Only the output numbering changes.

---

## 11. Paragraph Cards

Each paragraph should appear as a card.

Example:

```text
+--------------------------------+
| 003                        [✓] |
|                                |
| He realizes that the body      |
| already has many enemies.      |
|                                |
| page_014.jpg                   |
| 9:16                           |
+--------------------------------+
```

Clicking a paragraph card should load its crop state into the crop workspace.

Suggested states:

```text
○ No image assigned
◐ Image assigned
✓ Crop saved
```

---

## 12. Crop Workspace

The crop workspace should support:

- Dragging the crop area.
- Resizing the crop area.
- Zooming the source image.
- Panning the source image.
- Resetting the crop.
- Fitting the image to the viewer.
- Restoring a saved crop when returning to a paragraph.

Example:

```text
+------------------------------+
|                              |
|        SOURCE IMAGE          |
|                              |
|       +-----------+          |
|       |           |          |
|       |   CROP    |          |
|       |           |          |
|       +-----------+          |
|                              |
+------------------------------+
```

The frontend may display a scaled preview.

The backend should always crop from the original full-resolution file.

---

## 13. Aspect Ratios

Supported ratios:

```text
9:16
4:5
4:3
1:1
```

Default:

```text
9:16
```

Each paragraph remembers its own aspect ratio.

Example:

```text
Paragraph 1 -> 9:16
Paragraph 2 -> 9:16
Paragraph 3 -> 1:1
Paragraph 4 -> 4:5
Paragraph 5 -> 4:3
```

Changing one paragraph must not affect another paragraph.

---

## 14. Frontend Paragraph State

Example TypeScript model:

```ts
interface Paragraph {
  id: string;
  text: string;

  sourceImageId?: string;

  aspectRatio: "9:16" | "4:5" | "4:3" | "1:1";

  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  zoom: number;
  panX: number;
  panY: number;

  completed: boolean;
  outputFile?: string;
}
```

Default values:

```ts
{
  aspectRatio: "9:16",
  zoom: 1,
  panX: 0,
  panY: 0,
  completed: false
}
```

---

## 15. Assigning Images

Support multiple assignment methods.

### Click Assignment

1. Select a paragraph.
2. Double-click an image from the image library.

### Drag Assignment

Drag an image thumbnail onto a paragraph card.

### Reuse

Select another paragraph and assign the same image again.

Assigning an image should not copy or consume the original image.

---

## 16. Save & Next Workflow

The main fast-action button should be:

```text
Save & Next
```

Behavior:

```text
Crop current source image
        |
        v
Save output image
        |
        v
Update project JSON
        |
        v
Mark paragraph complete
        |
        v
Select next paragraph
```

Recommended keyboard shortcut:

```text
Ctrl + Enter
```

---

## 17. Keyboard Shortcuts

Suggested shortcuts:

```text
Left Arrow      Previous paragraph
Right Arrow     Next paragraph

1               9:16
2               4:5
3               4:3
4               1:1

R               Reset crop
F               Fit image

Ctrl + Enter    Save & Next
Ctrl + S        Save project

Delete          Remove current image assignment
```

---

## 18. Output Folder System

The user selects one base output directory.

Example:

```text
D:\Panel Crops\
```

Named project:

```text
Project Name: Flame Emperor
```

Creates:

```text
D:\Panel Crops\Flame Emperor\
```

Project structure:

```text
Flame Emperor/
├── project.json
├── script.txt
└── crops/
    ├── 001.png
    ├── 002.png
    ├── 003.png
    └── 004.png
```

---

## 19. Default Project Naming

If no project name is supplied:

```text
Project 1
```

If it already exists:

```text
Project 2
```

Then:

```text
Project 3
Project 4
Project 5
```

Example Python logic:

```python
number = 1

while folder_exists(f"Project {number}"):
    number += 1

project_name = f"Project {number}"
```

---

## 20. Duplicate Named Projects

If the user enters:

```text
Flame Emperor
```

and that project already exists, create:

```text
Flame Emperor 2
```

Then:

```text
Flame Emperor 3
Flame Emperor 4
```

Never overwrite an existing project automatically.

---

## 21. Output Naming

Output images should follow script order.

```text
001.png
002.png
003.png
004.png
005.png
```

Sequential names make the output directly correspond to script order.

If paragraphs are reordered, filenames may be regenerated during export.

---

## 22. Crop Export

When the frontend saves a crop, send the original image path and crop coordinates to FastAPI.

Example request:

```json
{
  "paragraphId": "p3",
  "sourceImage": "D:/Chapter1/015.jpg",
  "ratio": "9:16",
  "crop": {
    "x": 240,
    "y": 80,
    "width": 900,
    "height": 1600
  }
}
```

The backend uses Pillow to crop the original image.

Do not export the final crop from the browser's scaled preview.

This preserves full source resolution.

---

## 23. Crop Resolution

For the first version, preserve the source crop resolution.

Example:

```text
Original crop:
1350 x 2400

Saved:
1350 x 2400
```

Do not automatically upscale smaller images.

A later version can add optional fixed resolutions such as:

```text
Original Resolution
1080 x 1920
720 x 1280
```

---

## 24. Project JSON

Example:

```json
{
  "projectName": "Flame Emperor",
  "outputFolder": "D:/Panel Crops/Flame Emperor",
  "defaultAspectRatio": "9:16",

  "images": [
    {
      "id": "img-1",
      "path": "D:/Chapter1/page001.jpg"
    },
    {
      "id": "img-2",
      "path": "D:/Chapter1/page002.jpg"
    }
  ],

  "paragraphs": [
    {
      "id": "p1",
      "text": "He wakes up inside another person's body.",
      "sourceImageId": "img-1",
      "aspectRatio": "9:16",
      "crop": {
        "x": 300,
        "y": 100,
        "width": 720,
        "height": 1280
      },
      "zoom": 1,
      "panX": 0,
      "panY": 0,
      "completed": true,
      "outputFile": "crops/001.png"
    }
  ]
}
```

---

## 25. Image Library Features

Each image thumbnail should display:

- Thumbnail
- Filename
- Usage count

Example:

```text
page_001.jpg     Used 0x
page_002.jpg     Used 3x
page_003.jpg     Used 1x
```

Usage count is informational only.

Images can always be reused.

Optional later feature:

```text
page_025.jpg

Used in:
Paragraph 2
Paragraph 4
Paragraph 8
```

---

## 26. API Design

Suggested endpoints:

```text
POST   /projects
GET    /projects/{projectId}
PUT    /projects/{projectId}

POST   /projects/{projectId}/images
DELETE /projects/{projectId}/images/{imageId}

PUT    /projects/{projectId}/script

GET    /projects/{projectId}/paragraphs
PUT    /projects/{projectId}/paragraphs/{paragraphId}

POST   /projects/{projectId}/crop
POST   /projects/{projectId}/export
```

---

## 27. State Management

Use Zustand for frontend state.

Suggested store sections:

```text
project
images
paragraphs
activeParagraphId
activeImageId
cropState
outputFolder
isDirty
```

The frontend should update immediately.

Backend saves can happen through debounced autosave operations.

---

## 28. Autosave

Autosave when:

- Script changes.
- Paragraph order changes.
- An image is assigned.
- Crop coordinates change.
- Aspect ratio changes.
- A crop is completed.
- Project settings change.

Recommended debounce:

```text
500 ms
```

Avoid writing to disk on every mouse movement.

Crop movement can remain local until the interaction finishes.

---

## 29. UI Style

Use a dark editor-style interface.

Suggested direction:

```text
Background      Dark gray
Panels          Slightly lighter gray
Workspace       Near-black
Borders         Subtle
Selected item   Accent outline
Completed       Clear completion indicator
Pending         Neutral indicator
```

Prioritize workspace size over decorative UI.

The interface should feel closer to an image/video editing tool than a normal dashboard.

---

## 30. Development Phases

### Phase 1: Project System

Implement:

```text
Create project
Select output folder
Automatic project naming
Duplicate-name handling
Save project.json
Load existing project
```

### Phase 2: Frontend Layout

Implement:

```text
React application shell
Three-panel layout
Project header
Image library
Crop workspace
Script panel
Bottom controls
```

### Phase 3: Image Library

Implement:

```text
Drag-and-drop import
Thumbnail generation
Image list
Image removal
Image usage count
```

### Phase 4: Script System

Implement:

```text
Paste script
Blank-line paragraph detection
Paragraph cards
Editing
Adding
Deleting
Splitting
Merging
Reordering
```

### Phase 5: Image Assignment

Implement:

```text
Select paragraph
Assign image
Drag image onto paragraph
Reuse images
Restore previous assignments
```

### Phase 6: Crop Engine

Implement:

```text
Image preview
Crop overlay
Zoom
Pan
Resize
9:16
4:5
4:3
1:1
Crop restoration
```

### Phase 7: Backend Crop Export

Implement:

```text
FastAPI crop endpoint
Pillow full-resolution crop
Sequential output naming
Automatic crops folder
```

### Phase 8: Fast Workflow

Implement:

```text
Save
Save & Next
Previous
Next
Keyboard shortcuts
Completion states
```

### Phase 9: Autosave and Recovery

Implement:

```text
Debounced autosave
Project recovery
Missing source-image detection
Safe duplicate handling
Error messages
```

### Phase 10: Desktop Packaging

Implement:

```text
Tauri wrapper
Bundle frontend
Launch local backend
Filesystem permissions
Windows build
```

---

## 31. Minimum Viable Product

The first usable version should include:

```text
[✓] Create project
[✓] Select output folder
[✓] Automatic Project 1, Project 2 naming
[✓] Drag source images
[✓] Paste/edit script
[✓] Split script by blank lines
[✓] One paragraph = one output image
[✓] Assign source image to paragraph
[✓] Reuse source images
[✓] Interactive crop
[✓] Default 9:16
[✓] 4:5
[✓] 4:3
[✓] 1:1
[✓] Save crop
[✓] Save & Next
[✓] Sequential filenames
[✓] Automatic project subfolder
[✓] project.json save/load
```

---

## 32. Core Design Rule

The paragraph should be the fundamental work unit.

Each paragraph owns:

```text
Text
Source image reference
Aspect ratio
Crop coordinates
Zoom
Pan
Completion status
Output filename
```

Source images remain independent, reusable, and unchanged.

This allows the same image to be cropped repeatedly for different parts of the script without duplicating or modifying the original file.
