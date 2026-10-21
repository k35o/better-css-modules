---
"@better-css-modules/core": patch
---

The dependencies of core no longer carry known vulnerabilities into a project. postcss goes to 8.5.31 and source-map-js to 1.2.2, past the advisories on the stylesheets and source maps they read (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp, and a denial of service in indexed source maps). fast-glob is replaced by tinyglobby, because the braces it reaches through micromatch has a denial of service with no fixed version (GHSA-vfj7-8cjw-p6xm). The files `check`, `generate` and the plugins take in are the same as before: an `exclude` pattern still reaches into dot directories that an `include` pattern names.
