import type { Appearance } from "@/lib/appearance-types";
import { defaultAppearance } from "@/lib/appearance-types";

export type Visibility3 = "everyone" | "contacts" | "nobody";
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
  defaultHideFromIds: string[];
  storyAllowReplies: boolean;
  storyAllowShare: boolean;
  storyArchiveEnabled: boolean;
  searchHistory: string[];
  privacyPhone: Visibility3;
  privacyFindPhone: Visibility3;
  privacyEmail: Visibility3;
  privacyFindUsername: Visibility3;
  phoneAllowIds: string[];
  emailAllowIds: string[];
  findPhoneAllowIds: string[];
  findUsernameAllowIds: string[];
  officialVerified: boolean;
  privacyLastSeen: Visibility;
  lastSeenAllowIds: string[];
  privacyOnline: Visibility;
  onlineAllowIds: string[];
  readReceipts: boolean;
  showTyping: boolean;
  showVoiceRecording: boolean;
  privacyMessages: Visibility;
  messageAllowIds: string[];
  privacyGroups: Visibility;
  groupAllowIds: string[];
  privacyCommunities: Visibility;
  communityAllowIds: string[];
  privacyChannels: Visibility;
  channelAllowIds: string[];
  restrictForward: boolean;
  restrictSave: boolean;
  restrictShare: boolean;
  contactSyncEnabled: boolean;
  syncedContactHashes: string[];
  contactOsPermission: "unknown" | "allow" | "deny" | "limited";
  contactNotifyJoin: boolean;
  locationEnabled: boolean;
  lastSeenAt: number;
  typingUntil: number;
  typingThreadId: string;
  recordingUntil: number;
  deletionRequestedAt: number | null;
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
    defaultHideFromIds: [],
    storyAllowReplies: true,
    storyAllowShare: true,
    storyArchiveEnabled: true,
    searchHistory: [],
    privacyPhone: "contacts",
    privacyFindPhone: "contacts",
    privacyEmail: "nobody",
    privacyFindUsername: "everyone",
    phoneAllowIds: [],
    emailAllowIds: [],
    findPhoneAllowIds: [],
    findUsernameAllowIds: [],
    officialVerified: false,
    privacyLastSeen: "everyone",
    lastSeenAllowIds: [],
    privacyOnline: "everyone",
    onlineAllowIds: [],
    readReceipts: true,
    showTyping: true,
    showVoiceRecording: true,
    privacyMessages: "everyone",
    messageAllowIds: [],
    privacyGroups: "everyone",
    groupAllowIds: [],
    privacyCommunities: "everyone",
    communityAllowIds: [],
    privacyChannels: "everyone",
    channelAllowIds: [],
    restrictForward: false,
    restrictSave: false,
    restrictShare: false,
    contactSyncEnabled: false,
    syncedContactHashes: [],
    contactOsPermission: "unknown",
    contactNotifyJoin: true,
    locationEnabled: false,
    lastSeenAt: 0,
    typingUntil: 0,
    typingThreadId: "",
    recordingUntil: 0,
    deletionRequestedAt: null,
  };
}
