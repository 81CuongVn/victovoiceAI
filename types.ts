
export enum Region {
  HANOI = 'Hà Nội',
  HAI_PHONG = 'Hải Phòng',
  NGHE_AN = 'Nghệ An',
  HA_TINH = 'Hà Tĩnh',
  HUE = 'Huế',
  QUANG_NGAI = 'Quảng Ngãi',
  BINH_DINH = 'Bình Định',
  SAI_GON = 'Sài Gòn',
  MIEN_TAY = 'Miền Tây'
}

export enum Gender {
  MALE = 'Nam',
  FEMALE = 'Nữ'
}

export enum Mood {
  HAPPY = 'Vui mừng',
  FORMAL = 'Trang trọng',
  SAD = 'Buồn',
  SPEECH = 'Phát biểu',
  ADVERTISING = 'Quảng cáo',
  NARRATIVE = 'Thuyết minh',
  HUMOROUS = 'Hài hước',
  PRESENTATION = 'Thuyết trình'
}

export interface VoiceConfig {
  region: Region;
  gender: Gender;
  mood: Mood;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  script: string;
  region: Region;
  gender: Gender;
  mood: Mood;
  audioBlob: Blob;
  audioUrl: string;
}
