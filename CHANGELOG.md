# Changelog

## [0.2.0](https://github.com/robertbenjamin/lasso/compare/v0.1.0...v0.2.0) (2026-11-26)


### Features

* a Review kind for agents, picked by auto when the session title starts with "Review" ([52e5392](https://github.com/robertbenjamin/lasso/commit/52e5392a54789db74caf331c33c138cce1997410))
* a tab whose child agents made PRs counts as Ship ([2996eea](https://github.com/robertbenjamin/lasso/commit/2996eeab7e907cdf75ac734b882a635d4c2cad88))
* Agents folds like Spaces, and both section headers share one height, alignment and action button ([cd79d4d](https://github.com/robertbenjamin/lasso/commit/cd79d4d47b53dc4ade4d57d18b2aab6da1dfb4b6))
* auto kinds see reviews (PRs you are asked to review or reviewed) and tickets the first prompt asks to build ([2ac4539](https://github.com/robertbenjamin/lasso/commit/2ac4539d8b5f1c6948474d2dd9f28b31f29a1d01))
* hide the Spaces list from its header (–) or ⌘⇧B, and bring it back from the Agents header ([98e7c1c](https://github.com/robertbenjamin/lasso/commit/98e7c1c6dafb5f952de943e7d30a6d99ec7a5584))
* lasso has releases: release-please keeps a release PR, and /lasso-release turns it into readable notes ([fb3cac2](https://github.com/robertbenjamin/lasso/commit/fb3cac2f9598de41829e25d6e58a971cfa9240b4))
* release notes put the biggest changes first and mark each area with an emoji ([d3e96d4](https://github.com/robertbenjamin/lasso/commit/d3e96d4718eb2f16c61c3c0dc72b99ed02c43d17))


### Bug Fixes

* folding Spaces ends a space's hover, so the Agents list no longer stays dimmed ([d7e9288](https://github.com/robertbenjamin/lasso/commit/d7e92880799f3533795e99dbe192a150dca1a679))
* move lasso's commit rules into its CLAUDE.md and limit --space to user requests ([04c7b3f](https://github.com/robertbenjamin/lasso/commit/04c7b3f54df67111eb0f7fbe06a9d0c84cf3a931))
* name the words for parent, child and stacked agents ([132aaf5](https://github.com/robertbenjamin/lasso/commit/132aaf530cffbd9d8f3384a836bc1ba7d08b893a))
* New work jobs run in lasso-data, so ⌘⇧N works with the Spaces list hidden ([3a017d3](https://github.com/robertbenjamin/lasso/commit/3a017d3d7bcdcca9d1cc280839631a250fc2c49c))
* New work sends your text as typed, with no Implement or Review template around it ([10ceecf](https://github.com/robertbenjamin/lasso/commit/10ceecf79185a8874795145794af4d39aa321d0f))
* state lasso's principles and where rules go ([020fe34](https://github.com/robertbenjamin/lasso/commit/020fe345a934beb2934872d4763674e6b8d1208a))
* the Spaces list folds like a collapsible section: chevron and title in its header, which stays, with + still on the right ([d594c67](https://github.com/robertbenjamin/lasso/commit/d594c67da1658321ae43be10e12ef8ab5e7b9847))
* the Spaces list folds with a chevron after its title, not a – beside +, and unfolds from "Spaces ›" in the Agents header ([c7f4628](https://github.com/robertbenjamin/lasso/commit/c7f4628365c6bc9d1063960fb34825e252207309))
