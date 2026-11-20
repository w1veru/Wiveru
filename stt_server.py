import sys, os, json, threading

# Persistent faster-whisper server: JSON-lines over stdin/stdout.
# Request:  {"id": N, "path": "...audio file..."}
# Response: {"id": N, "text": "..."} or {"id": N, "error": "..."}

MODEL = os.environ.get("WIVERU_STT_MODEL", "turbo")

def main():
    from faster_whisper import WhisperModel
    model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=max(2, (os.cpu_count() or 4) - 2))
    sys.stdout.write(json.dumps({"ready": True, "model": MODEL}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            rid = req.get("id")
            path = req.get("path")
            segments, info = model.transcribe(
                path,
                language="ru",
                beam_size=1,
                condition_on_previous_text=False,
                vad_filter=True,
                initial_prompt="Виверу Вивер Остров Островок — голосовой помощник. Который час? Сколько времени? Во сколько? Какая погода? Которое сегодня число? Пауза. Стоп. Продолжи. Следующий трек. Предыдущий. Громче. Тише. Выключи звук. Включи музыку. Что ты умеешь? Открой дискорд. Выключи компьютер. Отмена.",
            )
            text = " ".join(s.text for s in segments).strip()
            sys.stdout.write(json.dumps({"id": rid, "text": text}) + "\n")
        except Exception as e:
            try:
                sys.stdout.write(json.dumps({"id": req.get("id"), "error": str(e)}) + "\n")
            except Exception:
                pass
        sys.stdout.flush()

if __name__ == "__main__":
    main()
