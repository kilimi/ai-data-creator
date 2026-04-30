"""Default source for the full app tree when installed from PyPI (no local git checkout)."""

import os

# GitHub archive (main branch). Override with env when forking or using a private mirror:
#   export LAI_BUNDLE_URL=https://codeload.github.com/you/lai/tar.gz/main
DEFAULT_BUNDLE_TARBALL = os.environ.get(
    "LAI_BUNDLE_URL",
    "https://codeload.github.com/lulu/lai/tar.gz/main",
)
