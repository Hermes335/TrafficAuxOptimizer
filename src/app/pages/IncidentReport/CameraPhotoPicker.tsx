import { Camera, ImagePlus, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);

function usePhotoUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const next = URL.createObjectURL(file); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function CameraPhotoPicker({ photo, onChange, disabled = false }: {
  photo: File | null; onChange: (photo: File | null) => void; disabled?: boolean;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [candidate, setCandidate] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const mounted = useRef(true);
  const photoUrl = usePhotoUrl(photo);
  const candidateUrl = usePhotoUrl(candidate);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStream(null);
  };
  const closeCamera = () => {
    request.current += 1;
    stopStream(); setCameraOpen(false); setStarting(false); setCapturing(false); setCandidate(null);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; request.current += 1;
      streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => { /* The native play control remains available. */ });
    }
  }, [stream]);
  useEffect(() => { if (disabled) closeCamera(); }, [disabled]);

  const openCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("The camera is unavailable here. Open this page over HTTPS or choose a photo from your device.");
      return;
    }
    const currentRequest = ++request.current;
    stopStream(); setCandidate(null); setCameraOpen(true); setStarting(true);
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 }, height: { ideal: 1200 } } });
      if (!mounted.current || currentRequest !== request.current) { nextStream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = nextStream; setStream(nextStream); setStarting(false);
    } catch (failure) {
      if (!mounted.current || currentRequest !== request.current) return;
      setStarting(false); setCameraOpen(false);
      const name = typeof failure === "object" && failure && "name" in failure ? String(failure.name) : "";
      setError(name === "NotAllowedError" ? "Camera permission was denied. You can choose a photo from your device instead."
        : name === "NotFoundError" ? "No camera was found. Choose a photo from your device instead."
          : "The camera could not start. Close other camera apps and try again, or choose a photo.");
    }
  };
  const selectPhoto = (file: File) => {
    if (!PHOTO_TYPES.has(file.type)) { setError("Choose a JPEG or PNG image."); return false; }
    if (file.size > MAX_PHOTO_BYTES) { setError("Choose an image smaller than 5 MB."); return false; }
    setError(null); onChange(file); return true;
  };
  const capture = () => {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) { setError("The camera is still getting ready. Please try again."); return; }
    const currentRequest = request.current;
    setError(null); setCapturing(true);
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, 1600 / Math.max(source.videoWidth, source.videoHeight));
    canvas.width = Math.round(source.videoWidth * ratio); canvas.height = Math.round(source.videoHeight * ratio);
    const context = canvas.getContext("2d");
    if (!context) { setCapturing(false); setError("Photo capture is unavailable. Choose a photo instead."); return; }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!mounted.current || currentRequest !== request.current) return;
      setCapturing(false);
      if (!blob) { setError("The photo could not be captured. Please try again."); return; }
      setCandidate(new File([blob], "incident-photo.jpg", { type: "image/jpeg" }));
      stopStream();
    }, "image/jpeg", 0.85);
  };

  return <div className="space-y-3">
    <p className="text-sm leading-relaxed text-slate-600">A clear photo can help staff assess the incident. Add one only when it is safe to do so.</p>
    {cameraOpen ? <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
      <div className="flex items-center justify-between px-4 py-3 text-white"><span className="text-sm font-medium">Incident camera</span><button type="button" onClick={closeCamera} aria-label="Close camera" className="grid h-10 w-10 place-items-center rounded-lg hover:bg-white/10"><X size={20} /></button></div>
      {candidateUrl ? <img src={candidateUrl} alt="Captured photo preview" className="max-h-80 w-full object-contain" />
        : <video ref={video} autoPlay muted playsInline controls className="aspect-[4/3] max-h-80 w-full object-contain" aria-label="Camera preview" />}
      {starting && <p role="status" className="px-4 py-2 text-sm text-white">Waiting for camera permission...</p>}
      <div className="flex gap-3 p-4">
        {candidate ? <><button type="button" onClick={openCamera} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-500 px-3 text-sm font-semibold text-white"><RotateCcw size={16} />Retake</button><button type="button" onClick={() => { if (selectPhoto(candidate)) closeCamera(); }} className="min-h-11 flex-1 rounded-xl bg-amber-400 px-3 text-sm font-semibold text-slate-950">Use photo</button></>
          : <button type="button" onClick={capture} disabled={!stream || capturing} className="min-h-11 flex-1 rounded-xl bg-amber-400 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50">{capturing ? "Capturing..." : "Capture photo"}</button>}
      </div>
    </div> : <>
      {photoUrl && <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"><img src={photoUrl} alt="Photo attached to your report" className="max-h-64 w-full object-contain" /><button type="button" onClick={() => onChange(null)} disabled={disabled} className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-white text-slate-700 shadow" aria-label="Remove photo"><X size={18} /></button></div>}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={openCamera} disabled={disabled} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"><Camera size={18} />Open camera</button>
        <label className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-amber-500 ${disabled ? "opacity-50" : ""}`}><ImagePlus size={18} />Choose photo<input aria-label="Choose photo" type="file" accept="image/jpeg,image/png" disabled={disabled} className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) selectPhoto(file); event.target.value = ""; }} /></label>
      </div>
    </>}
    <p className="text-xs text-slate-500">Optional. JPEG or PNG, up to 5 MB. Photos are visible to authorized staff.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
