# WikiReader Desktop (Tauri v2)

Desktop port scaffold based on the supplied WikiReader Android source (version 2.5.5). The UI uses the supplied `@m3e/web` 2.10.2 and `@m3e/icons` 1.0.20 packages as its component library.

## Included
- Tauri v2 desktop shell and Vite/React frontend
- M3E component-based navigation, search bar, buttons, cards, icon controls, progress indicators, switches, dividers and theme
- Wikipedia language selection, prefix search, featured feed, random article, article summary/full HTML reading, internal article navigation
- Local reading history and saved articles, with filter/remove/clear controls
- Theme scheme/accent, article text size, immersive mode, and About screen
- Responsive desktop and compact mobile layouts, including bottom navigation on narrow screens
- Persistent settings and a bounded local cache for recently read article HTML when offline
- Improved Wikipedia references, galleries, infoboxes, tables, and math layout

## Run
Requires Node.js, Rust, and Tauri v2 system prerequisites for your platform.

```sh
npm install
npm run tauri dev
```

Create desktop installers with `npm run tauri build`. GitHub Actions builds Linux, Windows, and macOS desktop packages, an Android APK, and an unsigned iOS Simulator app. The iOS artifact is for simulator validation, not App Store distribution; signing requires Apple credentials. Builds are delegated to GitHub Actions rather than run locally.

## Source and behavior notes
The original Android implementation uses Jetpack Compose Material 3 Expressive, Kotlin repositories/ViewModels, Room persistence and a rich custom wikitext renderer. This desktop implementation recreates the user-facing workflows using the provided M3E Web Components and Wikipedia's REST/Action APIs. The desktop version currently stores history and saved items in browser-local storage rather than Room, and full article rendering is provided by Wikipedia's rendered HTML endpoint rather than reimplementing Android's custom wikitext/transclusion renderer. This remains an incremental cross-platform port, not full feature parity: Android Room persistence, complete offline article downloads, the native wikitext/transclusion renderer, interactive charts and image experiences, full language management, all preference options, and accessibility/translation coverage still need dedicated implementation.
