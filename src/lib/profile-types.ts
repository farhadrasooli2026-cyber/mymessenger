import type { Appearance } from "@/lib/appearance-types";
import { defaultAppearance } from "@/lib/appearance-types";

export type Visibility = "everyone" | "contacts" | "nobody" | "selected";

export type PhotoKind = "default" | "upload" | "catalog";

export type UserPhoto = {
  kind: PhotoKind;
  catalogId?: string;
};

export type UsernameChange = {
  from: string;
  to: string;
  at: number;
};

export type CatalogCategory = {
  id: string;
  en: string;
  fa: string;
  sort: number;
};

export type CatalogItem = {
  id: string;
  categoryId: string;
  title: string;
  svg: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
};

export function defaultUserFields(): {
  usernameHistory: UsernameChange[];
  photo: UserPhoto;
  privacyPhoto: Visibility;
  privacyBio: Visibility;
  photoAllowIds: string[];
  bioAllowIds: string[];
  contactIds: string[];
  appearance: Appearance;
  blockedPeerKeys: string[];
  cryptoPublicKey: JsonWebKey | null;
  callPrivacy: Visibility;
  callAllowIds: string[];
  hideCallOnLockScreen: boolean;
  lowDataCalls: boolean;
  closeFriendIds: string[];
  mutedStoryUserIds: string[];
  storyNotifyOffIds: string[];
  statusPreset: "" | "available" | "busy" | "work" | "away" | "custom";
  statusText: string;
  statusPrivacy: Visibility;
  statusAllowIds: string[];
  defaultStoryPrivacy: "everyone" | "contacts" | "closeFriends" | "selected";
} {
  return {
    usernameHistory: [],
    photo: { kind: "default" },
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
    contactIds: [],
    appearance: defaultAppearance(),
    blockedPeerKeys: [],
    cryptoPublicKey: null,
    callPrivacy: "everyone",
    callAllowIds: [],
    hideCallOnLockScreen: false,
    lowDataCalls: false,
    closeFriendIds: [],
    mutedStoryUserIds: [],
    storyNotifyOffIds: [],
    statusPreset: "",
    statusText: "",
    statusPrivacy: "everyone",
    statusAllowIds: [],
    defaultStoryPrivacy: "everyone",
  };
}
