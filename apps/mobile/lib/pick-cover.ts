import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { COVER_ASPECT } from "./theme";

export type PickedCoverImage = {
  uri: string;
  name: string;
  mimeType: string;
};

function coverCropRect(width: number, height: number) {
  const target = COVER_ASPECT[0] / COVER_ASPECT[1];
  const current = width / height;
  if (Math.abs(current - target) < 0.01) {
    return { originX: 0, originY: 0, width, height };
  }
  if (current > target) {
    const newWidth = Math.max(1, Math.round(height * target));
    return {
      originX: Math.max(0, Math.floor((width - newWidth) / 2)),
      originY: 0,
      width: newWidth,
      height,
    };
  }
  const newHeight = Math.max(1, Math.round(width / target));
  return {
    originX: 0,
    originY: Math.max(0, Math.floor((height - newHeight) / 2)),
    width,
    height: newHeight,
  };
}

/**
 * Pick a book cover as portrait 3×4.
 *
 * Android can crop via the system editor (`aspect`).
 * iOS always forces a square crop when `allowsEditing` is true, so we skip
 * the system editor and center-crop to 3×4 with ImageManipulator instead.
 */
export async function pickBookCoverImage(): Promise<PickedCoverImage | null> {
  const useSystemCrop = Platform.OS === "android";
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
    allowsEditing: useSystemCrop,
    aspect: useSystemCrop ? [...COVER_ASPECT] : undefined,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const baseName =
    asset.fileName ||
    `cover.${(asset.mimeType || "image/jpeg").split("/")[1] || "jpg"}`;

  const width = asset.width || 0;
  const height = asset.height || 0;
  const ratioOk =
    width > 0 &&
    height > 0 &&
    Math.abs(width / height - COVER_ASPECT[0] / COVER_ASPECT[1]) < 0.02;

  // Android system crop already matches 3×4 when editing succeeds.
  if (useSystemCrop && ratioOk) {
    return {
      uri: asset.uri,
      name: baseName,
      mimeType: asset.mimeType || "image/jpeg",
    };
  }

  if (!width || !height) {
    return {
      uri: asset.uri,
      name: baseName.replace(/\.\w+$/, ".jpg"),
      mimeType: "image/jpeg",
    };
  }

  const crop = coverCropRect(width, height);
  const manipulated = await manipulateAsync(asset.uri, [{ crop }], {
    compress: 0.9,
    format: SaveFormat.JPEG,
  });

  return {
    uri: manipulated.uri,
    name: baseName.replace(/\.\w+$/, ".jpg"),
    mimeType: "image/jpeg",
  };
}
