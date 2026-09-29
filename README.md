# Local Web Annotator v0.4.7

This build changes folder sync to the direct selected-folder layout requested by the user.

## Folder layout

When you choose a folder and click **Save to folder**, the extension writes one JSON file per annotation set directly into the selected folder:

```text
SelectedFolder/
  Default.json
  Change_Log.json
  Step-by-Step_Workflow.json
  Project_Overview.json
  Prompt_Writing_Guidelines.json
  Rubric_Writing_Guidelines.json
  Rule_Classification_Guidelines.json
  Difficulty_Iteration.json
  QA_L1_Review.json
  Accounting_Tax.json
  Applied_Math.json
  Biology.json
  CARE_Mental_Health.json
  Chemistry.json
  Data_Science.json
  Engineering_CAD.json
  Law.json
  Medicine.json
  Physics_MS_SS_ES.json
  Pure_Math.json
```

Each JSON file is a normal page-annotation JSON file containing only that annotation set.

## Load from folder

**Load from folder** now first looks for JSON files directly in the selected folder and loads/merges them as annotation sets.

For backward compatibility, if no direct set JSON files are found, it falls back to the older layouts:

1. `SelectedFolder/WebAnnotations/<page-file-name-without-json>/*.json`
2. `SelectedFolder/WebAnnotations/<page-file-name>.json`

## Notes

- Select a page-specific annotation folder if you use the direct layout. Since the files are named by annotation set, the selected folder should correspond to the current page/instruction document.
- Existing manual **Save page JSON** / **Load page JSON** remains available.
- Older saved files should still load through fallback behavior.
