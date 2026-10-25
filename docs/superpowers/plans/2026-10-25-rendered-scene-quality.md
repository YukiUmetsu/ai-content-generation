# Implementation plan: rendered-scene quality

1. Add failing Node tests with compiled smoke footage and synthetic repetition/card-overflow cases, including immutability and semantic-recipe exclusions.
2. Implement `visual-quality.mjs` over compiled visual plan/shot map/job beats, reusing renderer text geometry.
3. Connect the additive report to `compileLiveVisualPreview`; test source IDs and identical production-plan SHA.
4. Display contextual review and jump-to-scene controls in `LiveRendererPreview`; write a UI behavior test for navigation and older previews.
5. Expose the actual middle-scene visual layout in the storyboard editor and support a surgical family revision, with a render-intent contract test.
6. Run local Node regression suite and best available frontend checks, inspect diff, then create a single PR on a fresh branch without invoking GitHub Actions.
