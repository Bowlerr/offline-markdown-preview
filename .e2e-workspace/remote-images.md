# Remote Images Fixture

This fixture is for remote image preview behaviour.

- With `offlineMarkdownViewer.preview.allowRemoteImages = false`, these should render as blocked placeholders with a download action.
- After choosing **Download Image**, the preview should swap to the cached local file.

## Local Image Baseline

![Local Grid](./assets/grid.svg)

## Remote Image Cases

![Remote Seeded](https://picsum.photos/seed/omv-remote-image/640/360)

![Remote With Query](https://picsum.photos/seed/omv-query-image/800/450?grayscale=1)

![Remote Duplicate URL](https://picsum.photos/seed/omv-remote-image/640/360)
