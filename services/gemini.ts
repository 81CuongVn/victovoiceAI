
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Region, Gender, Mood } from "../types";
import { decode, decodeAudioData } from "../utils/audio-utils";

export const createGeminiClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
};

export const generateScript = async (idea: string, duration: number): Promise<string> => {
  const ai = createGeminiClient();
  const prompt = `Hãy viết một kịch bản nói tiếng Việt dựa trên ý tưởng/tiêu đề sau: "${idea}". 
  Kịch bản cần có độ dài khoảng ${duration} giây khi đọc. 
  Chỉ trả về nội dung kịch bản, không kèm theo lời dẫn hay ghi chú khác. 
  Đảm bảo văn phong tự nhiên, phù hợp để lồng tiếng.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  return response.text || "";
};

const getRegionalPrompt = (region: Region) => {
  switch (region) {
    case Region.HANOI:
      return "Giọng Hà Nội chuẩn, thanh lịch, phát âm rõ ràng.";
    case Region.HAI_PHONG:
      return "Giọng Hải Phòng mạnh mẽ, dứt khoát.";
    case Region.NGHE_AN:
    case Region.HA_TINH:
      return `Giọng ${region} (Tiếng Nghệ) cực kỳ chân thực. Sử dụng "mô", "tê", "răng", "rứa".`;
    case Region.HUE:
      return "Giọng Huế ngọt ngào, nhẹ nhàng, mang hơi hướng cung đình.";
    case Region.QUANG_NGAI:
    case Region.BINH_DINH:
      return `Giọng ${region} đặc trưng miền Trung Trung Bộ.`;
    case Region.SAI_GON:
      return "Giọng Sài Gòn hiện đại, trẻ trung, phóng khoáng.";
    case Region.MIEN_TAY:
      return "Giọng Miền Tây sông nước, mộc mạc, ngọt ngào.";
    default:
      return `Giọng đặc trưng của vùng ${region}.`;
  }
};

export const generateTTS = async (
  text: string,
  region: Region,
  gender: Gender,
  mood: Mood,
  referenceAudio?: { data: string; mimeType: string }
) => {
  const ai = createGeminiClient();
  const voiceName = gender === Gender.MALE ? 'Puck' : 'Kore';
  const regionalInstruction = getRegionalPrompt(region);

  const textPart = {
    text: `Bạn là một chuyên gia lồng tiếng. 
    ${referenceAudio ? "Tôi có gửi kèm một đoạn âm thanh gốc mẫu. Hãy lắng nghe kỹ âm sắc, cao độ và cách phát âm trong đoạn mẫu đó để bắt chước hoàn hảo nhất có thể." : ""}
    Yêu cầu:
    1. Vùng miền: ${region} (${regionalInstruction}).
    2. Giới tính: ${gender}.
    3. Ngữ điệu & Trạng thái: ${mood}.
    4. Yêu cầu: Đọc văn bản dưới đây truyền cảm, tự nhiên.
    
    Văn bản cần đọc:
    ---
    ${text}
    ---`
  };

  const contents: any[] = [{ parts: [textPart] }];

  if (referenceAudio) {
    contents[0].parts.unshift({
      inlineData: {
        data: referenceAudio.data,
        mimeType: referenceAudio.mimeType,
      },
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: contents,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  return base64Audio;
};

export const connectLiveVoice = async (
  region: Region,
  gender: Gender,
  mood: Mood,
  callbacks: {
    onOpen: () => void;
    onMessage: (message: LiveServerMessage) => void;
    onError: (e: any) => void;
    onClose: (e: any) => void;
  }
) => {
  const ai = createGeminiClient();
  const voiceName = gender === Gender.MALE ? 'Fenrir' : 'Zephyr';
  const regionalInstruction = getRegionalPrompt(region);

  return ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
    callbacks: {
      onopen: callbacks.onOpen,
      onmessage: callbacks.onMessage,
      onerror: callbacks.onError,
      onclose: callbacks.onClose,
    },
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      },
      systemInstruction: `Bạn là trợ lý VictorVoice AI. Nói giọng ${region} (${gender}) phong cách ${mood}.`,
    },
  });
};
