# Panel Cropper: UI and Source Library Implementation Plan

## Goal

Make Panel Cropper feel like a focused desktop editing tool and organize source images by folder. A project can contain several imported folders plus a project-only **Project files** tab for individually imported images. Each image shows the script paragraph numbers for its saved crops.

This plan extends the existing application in `frontend/` and `backend/`. It does not replace the original `panel_cropper_implementation_plan.md`.

## Product decisions

1. **Folder imports are project snapshots.** Copy supported images into the project's `sources` directory, as individual file imports already do. Keep the original folder path as metadata for identification and display. Moving or deleting the original folder must not break saved crops. Automatic live synchronization is outside this change.
2. **Tabs represent source groups.** Each imported folder has one tab. Individual files always go into a single **Project files** group belonging to the current project, regardless of which tab is active.
3. **Folder identity uses its resolved original path.** Adding the same folder again selects its existing tab instead of making a duplicate. A later explicit refresh action can be designed separately; reimporting must not silently replace files that existing crops depend on.
4. **Tab switching only filters the library.** It must not change the selected image, active paragraph, crop rectangle, or workspace zoom. Importing a new folder selects its new tab.
5. **Paragraph numbers use script order.** Display one-based positions in `project.paragraphs`, padded to three digits. They must update after paragraph reorder, insertion, deletion, split, or merge. Do not store the numbers on images.
6. **Saved crops and draft assignments are distinct.** A completed paragraph contributes a `Cropped for 003` label to its `sourceImageId`. An unfinished paragraph contributes an `Assigned to 012` label to its effective draft image, if any. An explicitly cleared `draftImageId: null` contributes nothing.

## Intended interface

```text
SOURCE IMAGES (86)                         Add folder  Add files
[ Chapter 1 · 42 ] [ Chapter 2 · 36 ] [ Project files · 8 ]

[ thumbnail ]  002.webp
               Cropped for 003, 011

[ thumbnail ]  003.webp
               Assigned to 012
```

- Make **Add folder** the prominent empty-state and toolbar action; keep **Add files** available beside it.
- Place horizontally scrollable tabs below the pane title. Use a clear active state, truncated names, counts, and a tooltip containing the full source path. Two folders with the same basename remain separate tabs and can be distinguished by their path tooltip or a short parent-folder suffix.
- Show image dimensions as secondary metadata only when space allows. Replace `Used N×` with actual paragraph numbers. Show the first three numbers inline and `+N more` with the full list available on hover or focus.
- Use a real tablist with keyboard navigation and visible focus. A tab switches folders; it does not select an image.
- Do not put close buttons on tabs in this version. Removing a group requires explicit rules for images already referenced by paragraphs and should be handled as a separate feature.
- Preserve natural filename ordering (`2.webp` before `10.webp`) inside each group. For nested source folders, retain each image's relative path as metadata so duplicate filenames remain understandable.

## Data model and migration

Add to the project JSON and TypeScript `Project` type:

```ts
interface SourceGroup {
  id: string;
  name: string;
  kind: "folder" | "project-files";
  originalPath?: string; // folder groups only
  createdAt: string;
}

interface Project {
  // existing fields...
  sourceGroups: SourceGroup[];
}

interface SourceImage {
  // existing fields...
  sourceGroupId: string;
  relativePath?: string; // path within an imported folder
}
```

- Store `sourceGroups` in tab order. The **Project files** group is created on the first individual-file import, not globally or for every empty project.
- Give every new image a valid `sourceGroupId`. Keep existing image IDs and paragraph references unchanged.
- Normalize legacy projects when loading or opening them: if a project has images without groups, create its **Project files** group and assign those images to it. An empty legacy project can have no groups until its first import.
- Save the normalized project through the existing project manager. Preserve all existing source paths, crop data, and exported files. Run migration idempotently so repeated opens create no duplicate groups.
- Prefer stable group IDs and image IDs over names or array indices. Group names may repeat; paths and IDs establish identity.
- Keep an active tab ID in frontend state. On project open, choose the selected image's group if available, otherwise the first group. There is no need to persist active tab selection in the project file for this version.

## Backend work

1. **Folder picker:** Extend `POST /api/filesystem/select-folder` with an optional purpose (`output` or `source`) so the dialog title matches the action without changing the launcher workflow.
2. **Folder import endpoint:** Add `POST /api/projects/{project_id}/source-groups/folder` with `{ "path": "..." }`. Resolve and validate the directory, find JPG/JPEG, PNG, and WebP files recursively, and copy valid images into the project's `sources` directory. Exclude nonimages and unreadable files, and return imported/skipped counts plus the updated project. Reject importing the project folder or its descendants to avoid importing the app's own sources and crops; do not follow directory symlinks.
3. **Safe storage:** Use group and image IDs in destination names or directories to avoid filename collisions and path traversal. Record the original relative path for display and stable ordering. Retain the existing `image_path()` restriction that serves only files under the project's `sources` directory.
4. **Existing file upload endpoint:** Ensure `POST /api/projects/{project_id}/images` creates or reuses the project's **Project files** group and sets `sourceGroupId` on each imported image.
5. **Duplicate folder selection:** Compare normalized original paths using Windows-appropriate case handling. If the path already belongs to a group, return that group without duplicating its images or replacing copied files.
6. **Project normalization:** Apply the legacy migration consistently in create, open, load, and save paths. Do not let a stale whole-project save erase newly imported groups. Frontend imports should flush pending edits first and then use the updated project returned by the backend.
7. **Import feedback:** Return counts and skipped-file reasons concise enough for the UI to report partial success. Do not create an empty folder tab when a folder contains no supported, valid images.
8. **Existing API contract:** Correct the current `createProject` frontend API signature to pass the launcher's chosen output folder. Verify project creation before making the folder picker serve both output and source selection.

## Frontend work

1. Update `frontend/src/types/project.ts` and `frontend/src/services/api.ts` for source groups, folder selection, and folder import.
2. Add `activeSourceGroupId` and folder-import actions to `frontend/src/stores/projectStore.ts`. Preserve the crop workspace state during tab changes. After a successful import, take the project returned by the API and activate the imported group.
3. Refactor `frontend/src/components/ImageLibrary.tsx` into a title/action row, source-group tabs, and the image list filtered by active group. Individual file picker and file drops always target **Project files**.
4. Extract a pure image-to-paragraph-usage selector. For completed paragraphs, match `sourceImageId`; for pending paragraphs, respect `draftImageId` when defined and fall back to `sourceImageId`. Number badges follow script order, not the pending/completed queue display order.
5. Update image rows to show readable filenames, saved-crop paragraph badges, and a separate draft-assignment label. Keep click-to-select and drag-to-assign behavior working across tabs.
6. Make the source pane roughly **340px** wide on a typical desktop and support a draggable divider within sensible bounds. Preserve enough center width to crop comfortably; at narrower widths, allow a smaller source pane or a collapsible side pane rather than forcing horizontal page overflow.

## Visual refresh

- Replace the purple glow and generic dot branding with a restrained crop-corner mark and a neutral graphite palette. Use one warm accent for active selections and primary actions; keep the crop frame itself clearly visible over both dark and light images.
- Increase working text from the current 8–11px range to approximately 12–14px. Use smaller text only for secondary metadata. Make paragraph and image names easy to scan at normal desktop viewing distance.
- Reduce filled boxes and borders in the source and script panes. Use spacing and light dividers for list structure; reserve a strong outline for the active image or paragraph.
- Simplify header and footer emphasis: **Save crop and advance** remains the primary action. Group secondary controls so the canvas remains the visual center.
- Replace the workspace's decorative checker pattern with a quieter surface and remove the launcher glow/card treatment that reads as a generic dashboard.
- Define reusable color, type, spacing, border, and focus tokens in `frontend/src/styles.css` before restyling individual components.

## Implementation order

1. Add and test source-group normalization for existing projects.
2. Add backend folder import and update individual-file import.
3. Add frontend tab state, import controls, and filtered image lists.
4. Add saved-crop and draft-assignment paragraph labels.
5. Apply pane sizing and visual refresh; verify the launcher and editor at common desktop widths.
6. Update `README.md` with folder-import behavior, Project files, snapshot semantics, and paragraph labels.

## Acceptance checks

- Opening an existing project puts its images in **Project files** without changing any saved crops or paragraph assignments.
- Importing two different folders creates two switchable tabs; identical basenames do not merge them. Readding the same path does not duplicate images.
- A folder with nested directories and duplicate filenames imports safely, preserves recognizable relative paths, and sorts images naturally.
- Adding individual images creates or reuses **Project files** only in that project. File drops behave the same way.
- Switching tabs leaves the current canvas image and crop untouched. Images from either tab can still be dragged onto a paragraph.
- An image cropped for paragraphs 3 and 11 displays `003, 011`; reordering those paragraphs updates the displayed numbers. Pending assignments are labeled separately and do not claim a saved crop.
- Folder import handles unsupported or corrupt files without breaking valid imports. Removing an image still refuses when a paragraph references it.
- The editor remains usable at 1280px and 1440px widths, with readable metadata, visible focus states, and enough space for the crop canvas.
- Backend tests cover migration, imports, duplicate paths/names, and existing crop compatibility. Frontend selector tests cover completed versus draft usage and renumbering after reorder. Finish with a production frontend build and a manual visual pass.

## Relevant current files

- `frontend/src/components/ImageLibrary.tsx` — flat image list and `Used N×` label.
- `frontend/src/stores/projectStore.ts` — image import, selection, crop state, and autosave.
- `frontend/src/types/project.ts` and `frontend/src/services/api.ts` — project contracts and API calls.
- `frontend/src/styles.css` — pane widths and visual system.
- `backend/main.py` — folder picker and image import endpoints.
- `backend/services/project_manager.py` — project persistence, migration, and source-path checks.
