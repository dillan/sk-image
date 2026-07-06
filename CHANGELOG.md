# [1.5.0](https://github.com/dillan/sk-image/compare/v1.4.0...v1.5.0) (2026-07-06)


### Features

* report a clear error when the server's Node lacks node:sqlite ([e286727](https://github.com/dillan/sk-image/commit/e286727f8687c14578ae57d9d5fe110077622a52))
* run on Node 22.13+ by lowering the engines floor ([3433ca1](https://github.com/dillan/sk-image/commit/3433ca1a903d89696939a9aa264fb14424f93e2c)), closes [#55890](https://github.com/dillan/sk-image/issues/55890)

# [1.4.0](https://github.com/dillan/sk-image/compare/v1.3.0...v1.4.0) (2026-07-06)


### Bug Fixes

* push releases with a GitHub App token so the branch ruleset allows them ([9b54b79](https://github.com/dillan/sk-image/commit/9b54b79e2f8239d77be4997935f42d98cf0665b9))
* ship the app icon and changelog in the npm tarball ([5c10e86](https://github.com/dillan/sk-image/commit/5c10e864cd3bb43e9c622528292c38515ce58f09))


### Features

* add a revision token so clients can detect changes elsewhere ([01ba001](https://github.com/dillan/sk-image/commit/01ba001ddcfda36a0e7c29527288e88fa6fe4887))
* **webapp:** fix the upload flow and keep the library live ([a860b28](https://github.com/dillan/sk-image/commit/a860b2888ac9b879165d2c0ae9f93e669305dbd0))
* **webapp:** poll for changes every 5s instead of 10s ([d14b8c3](https://github.com/dillan/sk-image/commit/d14b8c33feb0c347a70aefdcccdef2152dbe7e0d))

# [1.3.0](https://github.com/dillan/sk-image/compare/v1.2.0...v1.3.0) (2026-07-05)


### Features

* let crew view and manage the image library under security ([#9](https://github.com/dillan/sk-image/issues/9)) ([18b38cc](https://github.com/dillan/sk-image/commit/18b38cccbee7cfeb62d7c33a52276262fa2c64ef))

# [1.2.0](https://github.com/dillan/sk-image/compare/v1.1.0...v1.2.0) (2026-07-05)


### Features

* multi-file image upload with progress and drag-and-drop ([8c02191](https://github.com/dillan/sk-image/commit/8c021911aa044d55fb372cc980d0611786f86b91))

# [1.1.0](https://github.com/dillan/sk-image/compare/v1.0.0...v1.1.0) (2026-07-04)


### Bug Fixes

* don't return error detail to the client in the KIP e2e server ([85bcae7](https://github.com/dillan/sk-image/commit/85bcae72101bff13b01ddf9264ea8000b49a9df7))
* lower default resize-cache budget to 1 GiB ([6bb79b8](https://github.com/dillan/sk-image/commit/6bb79b86b344513cefadd8d928c669c1c5df3e00))
* release the corrupt db handle before quarantining it (Windows) ([8397345](https://github.com/dillan/sk-image/commit/83973456df5dc0a0c6863ca36c2aa05a88f6b0f8))
* require read-write/admin permission for sk-image writes ([8cd45ee](https://github.com/dillan/sk-image/commit/8cd45eeea2c6b510b730155ff972f2c8e2497576))
* return 403 (not 401) when a logged-in user lacks write access ([4d9c8da](https://github.com/dillan/sk-image/commit/4d9c8dac97e2593fcc63b474065b81ed743c0153))


### Features

* friendlier cache-size config and cache-budget display ([cba7260](https://github.com/dillan/sk-image/commit/cba7260e7d9692a9d293d6cdb72a90cbff462767))
* keep capture GPS and raw EXIF off the public read paths ([c7f0bb5](https://github.com/dillan/sk-image/commit/c7f0bb5184bda5e4f911d7d975f82d7fe522c394))
* publish an OpenAPI definition for the image API ([3a2baba](https://github.com/dillan/sk-image/commit/3a2babac103dd96667cae0855d715e5a3f193332))
* report plugin health via status, error, and notifications ([8518912](https://github.com/dillan/sk-image/commit/8518912497d8934102cb9b6b0a45db4c67462c8b))

# 1.0.0 (2026-07-03)


### Features

* image library plugin with SQLite metadata and cache cap ([699b153](https://github.com/dillan/sk-image/commit/699b153c1be4b2f53bd07d5eca9027d4a0e9bc0d))
