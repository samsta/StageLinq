export interface Track {
  id: number,
  playOrder: number,
  length: number,
  bpm: number,
  year: number,
  path: string,
  filename: string,
  bitrate: number,
  bpmAnalyzed: number,
  albumArtId: number,
  fileBytes: number,
  title: string,
  artist: string,
  album: string,
  genre: string,
  comment: string,
  label: string,
  composer: string,
  remixer: string,
  key: number,
  rating: number,
  albumArt: string,
  timeLastPlayed: string,
  isPlayed: boolean,
  fileType: string,
  isAnalyzed: boolean,
  dateCreated: string,
  dateAdded: string,
  isAvailable: boolean,
  isMetadataOfPackedTrackChanged: boolean,
  isPerfomanceDataOfPackedTrackChanged: boolean,
  playedIndicator: number,
  isMetadataImported: boolean,
  pdbImportKey: number,
  streamingSource: string,
  uri: string,
  isBeatGridLocked: boolean,
  originDatabaseUuid: string,
  originTrackId: number,
  trackData: Buffer,
  overviewWaveFormData: Buffer,
  beatData: Buffer,
  quickCues: Buffer,
  loops: Buffer,
  thirdPartySourceId: number,
  streamingFlags: number,
  explicitLyrics: boolean,
  activeOnLoadLoops: number
}