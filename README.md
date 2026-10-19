# WikiReader Desktop (Tauri v2)

Desktop port scaffold based on the supplied WikiReader Android source (version 2.5.5). The UI uses the supplied `@m3e/web` 2.10.2 and `@m3e/icons` 1.0.20 packages as its component library.

## Included
- Tauri v2 desktop shell and Vite/React frontend
- M3E component-based navigation, search bar, buttons, cards, icon controls, progress indicators, switches, dividers and theme
- Wikipedia language selection, prefix search, featured feed, random article, article summary/full HTML reading, internal article navigation
- Local reading history and saved articles, with filter/remove/clear controls
- Theme scheme/accent, article text size, immersive mode, and About screen
- Responsive desktop layout and persistent settings in local storage

## Run
Requires Node.js, Rust, and Tauri v2 system prerequisites for your platform.

```sh
npm install
npm run tauri dev
```

Create installers with `npm run tauri build`. This project has intentionally not been locally built or installer-tested; use the repository's CI/actions to validate native builds.

## Source and behavior notes
The original Android implementation uses Jetpack Compose Material 3 Expressive, Kotlin repositories/ViewModels, Room persistence and a rich custom wikitext renderer. This desktop implementation recreates the user-facing workflows using the provided M3E Web Components and Wikipedia's REST/Action APIs. The desktop version currently stores history and saved items in browser-local storage rather than Room, and full article rendering is provided by Wikipedia's rendered HTML endpoint rather than reimplementing Android's custom wikitext/transclusion renderer. Some Android-specific functions (offline/cache behavior, detailed reference/infobox/chart rendering, language-management workflow, full preference parity and all accessibility/translation strings) still require parity work before calling this a complete feature-equivalent port.
