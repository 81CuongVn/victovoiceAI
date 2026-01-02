
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Region, Gender, Mood, HistoryItem } from './types';
import { generateTTS, connectLiveVoice, generateScript } from './services/gemini';
import { createPcmBlob, decode, decodeAudioData, pcmToWav } from './utils/audio-utils';
import { LiveServerMessage } from '@google/genai';

const App: React.FC = () => {
  const [idea, setIdea] = useState<string>('');
  const [duration, setDuration] = useState<number>(30);
  const [script, setScript] = useState<string>('');
  const [region, setRegion] = useState<Region>(Region.HANOI);
  const [voiceGender, setVoiceGender] = useState<Gender>(Gender.FEMALE);
  const [voiceMood, setVoiceMood] = useState<Mood>(Mood.FORMAL);
  const [referenceAudio, setReferenceAudio] = useState<{ data: string; mimeType: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const [isGeneratingScript, setIsGeneratingScript] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isPreviewing, setIsPreviewing] = useState<Gender | null>(null);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [lastAudioBlob, setLastAudioBlob] = useState<Blob | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputAudioCtx = useRef<AudioContext | null>(null);
  const outputAudioCtx = useRef<AudioContext | null>(null);
  const nextStartTime = useRef<number>(0);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const liveSessionPromise = useRef<Promise<any> | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setReferenceAudio({
        data: base64,
        mimeType: file.type || 'audio/mpeg'
      });
    };
    reader.readAsDataURL(file);
  };

  const handleCreateScript = async () => {
    if (!idea.trim()) return;
    setIsGeneratingScript(true);
    try {
      const contextPrompt = `Hãy viết một kịch bản nói tiếng Việt cho vùng ${region}, với giọng ${voiceGender} và ngữ điệu ${voiceMood}. 
      Sử dụng các từ ngữ địa phương đặc trưng của ${region} nếu cần thiết để kịch bản tự nhiên nhất. 
      Chủ đề: ${idea}`;
      
      const generatedText = await generateScript(contextPrompt, duration);
      setScript(generatedText);
    } catch (error) {
      console.error("Script Generation Error:", error);
      alert("Lỗi khi tạo kịch bản. Vui lòng thử lại.");
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleVoicePreview = async (gender: Gender) => {
    if (isPreviewing) return;
    setIsPreviewing(gender);
    try {
      const previewText = `Thử giọng ${gender} ${region} ${voiceMood}.`;
      const base64 = await generateTTS(previewText, region, gender, voiceMood, referenceAudio || undefined);
      if (base64) {
        const binary = decode(base64);
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const buffer = await decodeAudioData(binary, ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start();
        source.onended = () => setIsPreviewing(null);
      }
    } catch (error) {
      console.error("Preview Error:", error);
      setIsPreviewing(null);
    }
  };

  const handleGenerate = async () => {
    if (!script.trim()) return;
    setIsGenerating(true);
    setAudioUrl(null);
    setLastAudioBlob(null);

    try {
      const base64 = await generateTTS(script, region, voiceGender, voiceMood, referenceAudio || undefined);
      if (base64) {
        const binary = decode(base64);
        const sampleRate = 24000;
        const wavBlob = pcmToWav(binary, sampleRate);
        const blobUrl = URL.createObjectURL(wavBlob);
        
        setLastAudioBlob(wavBlob);

        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
        const buffer = await decodeAudioData(binary, ctx, sampleRate, 1);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = playbackSpeed;
        source.connect(ctx.destination);
        source.start();
        
        setAudioUrl('playing');
        source.onended = () => setAudioUrl(null);

        // Thêm vào lịch sử
        const newHistoryItem: HistoryItem = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          script: script,
          region: region,
          gender: voiceGender,
          mood: voiceMood,
          audioBlob: wavBlob,
          audioUrl: blobUrl
        };
        setHistory(prev => [newHistoryItem, ...prev]);
      }
    } catch (error) {
      console.error("TTS Error:", error);
      alert("Lỗi khi tạo giọng nói. Vui lòng thử lại.");
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadAudioFile = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const restoreFromHistory = (item: HistoryItem) => {
    setScript(item.script);
    setRegion(item.region);
    setVoiceGender(item.gender);
    setVoiceMood(item.mood);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stopLiveSession = useCallback(() => {
    setIsLive(false);
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach(track => track.stop());
      mediaStream.current = null;
    }
    if (inputAudioCtx.current) {
      inputAudioCtx.current.close();
      inputAudioCtx.current = null;
    }
    if (outputAudioCtx.current) {
      outputAudioCtx.current.close();
      outputAudioCtx.current = null;
    }
    nextStartTime.current = 0;
    activeSources.current.forEach(s => s.stop());
    activeSources.current.clear();
    liveSessionPromise.current = null;
  }, []);

  const startLiveSession = async () => {
    try {
      setIsLive(true);
      inputAudioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      mediaStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      liveSessionPromise.current = connectLiveVoice(region, voiceGender, voiceMood, {
        onOpen: () => {
          const source = inputAudioCtx.current!.createMediaStreamSource(mediaStream.current!);
          const scriptProcessor = inputAudioCtx.current!.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmBlob = createPcmBlob(inputData);
            liveSessionPromise.current?.then((session) => {
              session.sendRealtimeInput({ media: pcmBlob });
            });
          };
          source.connect(scriptProcessor);
          scriptProcessor.connect(inputAudioCtx.current!.destination);
        },
        onMessage: async (message: LiveServerMessage) => {
          const base64 = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (base64 && outputAudioCtx.current) {
            nextStartTime.current = Math.max(nextStartTime.current, outputAudioCtx.current.currentTime);
            const binary = decode(base64);
            const buffer = await decodeAudioData(binary, outputAudioCtx.current, 24000, 1);
            const source = outputAudioCtx.current.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = playbackSpeed;
            source.connect(outputAudioCtx.current.destination);
            source.onended = () => activeSources.current.delete(source);
            source.start(nextStartTime.current);
            nextStartTime.current += buffer.duration;
            activeSources.current.add(source);
          }
          if (message.serverContent?.interrupted) {
            activeSources.current.forEach(s => s.stop());
            activeSources.current.clear();
            nextStartTime.current = 0;
          }
        },
        onError: (e) => {
          console.error("Live Voice Error:", e);
          stopLiveSession();
        },
        onClose: () => {
          stopLiveSession();
        }
      });
    } catch (error) {
      console.error("Failed to start live session:", error);
      alert("Lỗi micro.");
      stopLiveSession();
    }
  };

  useEffect(() => {
    return () => {
      stopLiveSession();
      history.forEach(item => URL.revokeObjectURL(item.audioUrl));
    };
  }, [stopLiveSession]);

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center bg-slate-50 text-slate-900">
      <header className="w-full max-w-5xl mb-10 flex flex-col items-center text-center">
        <div className="bg-indigo-600 p-4 rounded-3xl mb-4 shadow-xl shadow-indigo-200">
          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h1 className="text-4xl font-black text-slate-900 mb-2 tracking-tight">VictorVoice AI</h1>
        <p className="text-slate-500 max-w-xl font-medium uppercase tracking-widest text-[10px]">Cá nhân hóa giọng nói vùng miền</p>
      </header>

      <main className="w-full max-w-5xl space-y-8 pb-32">
        {/* STEP 1: VOICE CONFIG & FILE UPLOAD */}
        <section className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
          <div className="flex items-center gap-4 mb-8">
            <span className="flex items-center justify-center w-10 h-10 rounded-full bg-indigo-600 text-white font-bold">1</span>
            <h2 className="text-2xl font-bold">Thiết lập Giọng đọc & Vùng miền</h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Region */}
            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">1. Vùng miền</label>
              <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                {Object.values(Region).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRegion(r)}
                    className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all ${
                      region === r ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Gender */}
            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">2. Giới tính</label>
              <div className="flex flex-col gap-2">
                {Object.values(Gender).map((g) => (
                  <div key={g} className="flex gap-1">
                    <button
                      onClick={() => setVoiceGender(g)}
                      className={`flex-grow py-3 rounded-xl text-sm font-bold border transition-all ${
                        voiceGender === g ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      {g}
                    </button>
                    <button onClick={() => handleVoicePreview(g)} className="px-4 rounded-xl bg-indigo-50 text-indigo-600 text-xs font-bold">Thử</button>
                  </div>
                ))}
              </div>
              <button
                onClick={isLive ? stopLiveSession : startLiveSession}
                className={`w-full py-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                  isLive ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
                }`}
              >
                {isLive ? "Dừng Live" : "Học nói trực tiếp"}
              </button>
            </div>

            {/* Mood */}
            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">3. Ngữ điệu</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.values(Mood).map((m) => (
                  <button
                    key={m}
                    onClick={() => setVoiceMood(m)}
                    className={`py-2 px-1 rounded-xl text-[10px] font-bold border transition-all ${
                      voiceMood === m ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* File Upload */}
            <div className="space-y-4">
              <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">4. Học âm gốc (Tùy chọn)</label>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`relative group cursor-pointer border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center transition-all min-h-[140px] ${
                  referenceAudio ? 'bg-indigo-50 border-indigo-400' : 'bg-slate-50 border-slate-300 hover:border-indigo-400'
                }`}
              >
                <input type="file" ref={fileInputRef} className="hidden" accept="audio/*" onChange={handleFileUpload} />
                {referenceAudio ? (
                  <div className="text-center">
                    <svg className="w-8 h-8 text-indigo-600 mx-auto mb-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                    <span className="text-[10px] font-bold text-indigo-700">Đã tải âm gốc</span>
                    <button onClick={(e) => { e.stopPropagation(); setReferenceAudio(null); }} className="block mt-1 mx-auto text-[9px] text-red-500 underline font-bold uppercase">Xóa</button>
                  </div>
                ) : (
                  <>
                    <svg className="w-8 h-8 text-slate-400 mb-2 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    <span className="text-[10px] font-bold text-slate-500 text-center">Tải giọng mẫu (AI sẽ bắt chước)</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* STEP 2: CREATE SCRIPT BASED ON CONFIG */}
        <section className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
          <div className="flex items-center gap-4 mb-6">
            <span className="flex items-center justify-center w-10 h-10 rounded-full bg-indigo-600 text-white font-bold">2</span>
            <h2 className="text-2xl font-bold">Thiết kế kịch bản lồng tiếng</h2>
          </div>
          
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Chủ đề hoặc Bối cảnh kịch bản</label>
                <input
                  type="text"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="Ví dụ: Kể về kỷ niệm lần đầu ăn bún đậu mắm tôm..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-medium text-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2 uppercase tracking-wider">Độ dài dự kiến (s)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-center"
                  />
                  <button
                    disabled={isGeneratingScript || !idea.trim()}
                    onClick={handleCreateScript}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-6 py-4 rounded-2xl font-bold shadow-lg shadow-indigo-100 transition-all text-sm whitespace-nowrap"
                  >
                    {isGeneratingScript ? "Đang viết..." : "Tạo Kịch Bản"}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 italic">AI sẽ tự động lồng ghép phương ngữ <b>{region}</b> và sắc thái <b>{voiceMood}</b> vào văn bản.</p>
          </div>
        </section>

        {/* STEP 3: FINAL SCRIPT & GENERATE AUDIO */}
        <section className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
          <div className="flex items-center gap-4 mb-6">
            <span className="flex items-center justify-center w-10 h-10 rounded-full bg-indigo-600 text-white font-bold">3</span>
            <h2 className="text-2xl font-bold">Biên tập & Xuất âm thanh</h2>
          </div>

          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Nội dung kịch bản chi tiết..."
            className="w-full bg-slate-50 border border-slate-200 rounded-3xl p-6 min-h-[200px] focus:ring-2 focus:ring-indigo-500 outline-none text-lg leading-relaxed font-medium"
          />

          <div className="mt-8 flex flex-col items-center">
            <button
              disabled={isGenerating || !script.trim()}
              onClick={handleGenerate}
              className="w-full max-w-xl py-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-[2rem] font-black text-2xl transition-all shadow-2xl flex items-center justify-center gap-4 uppercase tracking-tighter"
            >
              {isGenerating ? "Đang tạo giọng nói..." : "Xuất file âm thanh"}
            </button>
          </div>

          {/* Results Area */}
          {(audioUrl || lastAudioBlob) && (
            <div className="mt-10 w-full bg-slate-50 p-6 md:p-8 rounded-[3rem] border-2 border-indigo-200 animate-in fade-in slide-in-from-bottom-8 duration-500">
              <div className="flex flex-col md:flex-row items-center gap-8">
                <div className="w-full md:w-1/3 text-center md:text-left">
                  <h3 className="text-xl font-black text-indigo-600 uppercase">Hoàn tất!</h3>
                  <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-widest">{region} • {voiceGender} • {voiceMood}</p>
                </div>

                <div className="flex-grow w-full space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase">
                    <span>Tốc độ: {playbackSpeed}x</span>
                    <div className="flex gap-1">
                       {[0.8, 1.0, 1.2, 1.5].map(s => (
                         <button key={s} onClick={() => setPlaybackSpeed(s)} className={`w-8 h-8 rounded-full border ${playbackSpeed === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white'}`}>{s}</button>
                       ))}
                    </div>
                  </div>
                  <input type="range" min="0.5" max="2.0" step="0.1" value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))} className="w-full h-2 bg-indigo-100 rounded-full appearance-none cursor-pointer accent-indigo-600" />
                </div>

                <div className="flex gap-2 w-full md:w-auto">
                  <button onClick={handleGenerate} className="p-4 bg-white border border-slate-200 rounded-2xl hover:bg-slate-100 transition-all">
                    <svg className="w-6 h-6 text-indigo-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                  </button>
                  <button onClick={() => lastAudioBlob && downloadAudioFile(lastAudioBlob, `VictorVoice_${region}.wav`)} className="flex-grow py-4 px-6 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2 text-sm uppercase">
                    Tải file (.WAV)
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* STEP 4: HISTORY */}
        {history.length > 0 && (
          <section className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <span className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-800 text-white font-bold">4</span>
                <h2 className="text-2xl font-bold">Lịch sử sáng tạo</h2>
              </div>
              <button 
                onClick={() => {
                  history.forEach(item => URL.revokeObjectURL(item.audioUrl));
                  setHistory([]);
                }}
                className="text-xs font-bold text-red-500 uppercase hover:underline"
              >
                Xóa tất cả
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {history.map((item) => (
                <div key={item.id} className="bg-slate-50 p-5 rounded-3xl border border-slate-100 flex flex-col gap-4 group hover:border-indigo-200 transition-all">
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{item.region} • {item.gender}</span>
                      <span className="text-[9px] font-bold text-slate-400 mt-0.5">{new Date(item.timestamp).toLocaleString('vi-VN')}</span>
                    </div>
                    <span className="px-2 py-1 bg-amber-100 text-amber-600 rounded-lg text-[9px] font-bold uppercase">{item.mood}</span>
                  </div>
                  
                  <p className="text-xs text-slate-600 line-clamp-2 font-medium bg-white p-3 rounded-xl border border-slate-100 italic">
                    "{item.script}"
                  </p>

                  <div className="flex gap-2">
                    <audio src={item.audioUrl} controls className="h-8 flex-grow" />
                    <button 
                      onClick={() => restoreFromHistory(item)}
                      title="Sử dụng lại kịch bản này"
                      className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-indigo-50 hover:text-indigo-600 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                    <button 
                      onClick={() => downloadAudioFile(item.audioBlob, `VictorVoice_${item.region}_${item.id}.wav`)}
                      className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="w-full py-10 text-center text-slate-400 border-t border-slate-100 mt-10">
        <p className="font-bold text-slate-900 text-sm">VictorVoice AI © 2024</p>
      </footer>

      {isLive && (
        <div className="fixed bottom-10 right-10 z-50">
          <div className="bg-red-600 text-white px-8 py-5 rounded-full shadow-2xl flex items-center gap-4 animate-bounce">
            <span className="flex h-3 w-3 rounded-full bg-white animate-pulse"></span>
            <div className="flex flex-col">
              <span className="font-black text-[10px] tracking-widest uppercase">Live Active</span>
              <span className="text-[8px] font-bold opacity-80">{region}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
