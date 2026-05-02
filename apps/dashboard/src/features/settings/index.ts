// Public surface of the `settings` feature.
// Routes (src/routes/*) import from here, never from sub-paths directly.
//
// Convention:
//   export { SettingsScreen } from './components/SettingsScreen'
//   export { useSettings } from './hooks/useSettings'
//
// Internal-only modules (services/, components/, hooks/) are NOT re-exported
// here — they're consumed within the feature only.
