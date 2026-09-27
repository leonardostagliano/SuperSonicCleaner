#!/usr/bin/env bash
# SuperSonicCleaner Linux installer. Run as your desktop user, without sudo.
# Download and inspect this script before running it:
# https://raw.githubusercontent.com/leonardostagliano/SuperSonicCleaner/main/scripts/install.sh

set -euo pipefail

REPO="leonardostagliano/SuperSonicCleaner"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/SuperSonicCleaner"
BIN_DIR="$HOME/.local/bin"
BIN_LINK="$BIN_DIR/SuperSonicCleaner"

if [[ $# -gt 0 ]]; then
  if [[ $# -eq 1 && "$1" == "--help" ]]; then
    echo "Install the latest SuperSonicCleaner AppImage for the current Linux user."
    echo "Usage: bash install.sh"
    exit 0
  fi
  echo "Unsupported option. Use --help for usage." >&2
  exit 1
fi

for tool in curl jq sha256sum uname mktemp readlink awk; do
  command -v "$tool" >/dev/null || { echo "Required command not found: $tool" >&2; exit 1; }
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer is for Linux only." >&2
  exit 1
fi
if [[ $EUID -eq 0 ]]; then
  echo "Run this installer as your desktop user, without sudo." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64) ARCH_LABEL="x86_64" ;;
  aarch64|arm64) ARCH_LABEL="arm64" ;;
  *) echo "Unsupported architecture." >&2; exit 1 ;;
esac

ASSET_NAME="SuperSonicCleaner-${ARCH_LABEL}.AppImage"
APPIMAGE_PATH="$INSTALL_DIR/$ASSET_NAME"
if [[ -e "$BIN_LINK" || -L "$BIN_LINK" ]]; then
  if [[ ! -L "$BIN_LINK" || "$(readlink "$BIN_LINK")" != "$APPIMAGE_PATH" ]]; then
    echo "An unrelated file already exists at $BIN_LINK. Installation stopped." >&2
    exit 1
  fi
fi

echo "Finding the latest SuperSonicCleaner release..."
VERSION=$(curl --proto '=https' --tlsv1.2 -fsSL "https://api.github.com/repos/$REPO/releases/latest" | jq -er '.tag_name')
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "The release version is invalid." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
STAGING=$(mktemp -d "$INSTALL_DIR/.download.XXXXXX")
trap 'rm -rf -- "$STAGING"' EXIT
DOWNLOAD_BASE="https://github.com/$REPO/releases/download/$VERSION"
curl --proto '=https' --tlsv1.2 -fsSL "$DOWNLOAD_BASE/SHA256SUMS.txt" -o "$STAGING/SHA256SUMS.txt"
curl --proto '=https' --tlsv1.2 -fSL "$DOWNLOAD_BASE/$ASSET_NAME" -o "$STAGING/$ASSET_NAME"

CHECKSUM=$(awk -v name="$ASSET_NAME" '$2 == name { print $1 }' "$STAGING/SHA256SUMS.txt")
if [[ ! "$CHECKSUM" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo "Missing or invalid release checksum." >&2
  exit 1
fi
(
  cd "$STAGING"
  printf '%s  %s\n' "$CHECKSUM" "$ASSET_NAME" | sha256sum --check --status
)

chmod +x "$STAGING/$ASSET_NAME"
mv -f -- "$STAGING/$ASSET_NAME" "$APPIMAGE_PATH"
ln -sfn -- "$APPIMAGE_PATH" "$BIN_LINK"

echo "Installed SuperSonicCleaner $VERSION to $APPIMAGE_PATH"
echo "Start it with: $BIN_LINK"
echo "This user-owned AppImage supports updates from the app's About page."
echo "If your system requires FUSE support, install its libfuse2 runtime package."
