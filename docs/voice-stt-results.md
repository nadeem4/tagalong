# Speech model measurements (V3)

What the speech-to-text candidates scored on the dev PC, the Auto rule chosen from the numbers,
and how to run it again. Harness: `brain/tools/stt_bench/` (see [voice.md](voice.md)).

## Setup

- PC: i7-13620H (20 threads), 16 GB RAM, RTX 4060 laptop GPU with the NVIDIA driver, no CUDA
  toolkit. Run on 2026-11-13, one model per invocation (one model in memory at a time).
- Corpus: 15 clips. Five Kokoro lines ("Scout, what time is it?", disk space on drive C, "Hey
  Scout, find the file called budget two thousand twenty six.", 347 times 12, "Scout, open the
  downloads folder") in three voices (`bm_george`, `af_heart`, `am_michael`), white noise mixed in
  at 15 dB SNR. No recorded clips of a real person yet: this is synthetic speech, so absolute
  numbers are friendlier than a real room and the ranking between close models is weak evidence.
- Columns: WER (lower is better); name kept (the first word, after "hey", passes the
  sound-alike rule for "Scout"); CPU cores (process CPU time over wall time while decoding; it
  adds up all threads); GPU peak % (nvidia-smi); s per clip (mean decode time for a whole clip
  fed at once, so for a final model it is the wait after the end of the turn; for a live model it
  is feed plus finish, not a real-time figure). Clips run about 3 to 5 s long.

## Results

| model                  | role  | run                                  | WER   | name kept | CPU cores | GPU peak % | s per clip |
| ---------------------- | ----- | ------------------------------------ | ----- | --------- | --------- | ---------- | ---------- |
| moonshine-tiny         | live  | CPU (no GPU path)                    | 0.238 | 87%       | 15.31     | 21         | 2.60       |
| moonshine-small        | live  | CPU (no GPU path)                    | 0.193 | 100%      | 15.44     | 16         | 5.14       |
| moonshine-medium       | live  | CPU (no GPU path)                    | 0.199 | 100%      | 15.60     | 3          | 6.47       |
| whisper-large-v3-turbo | final | GPU requested                        | 0.199 | 100%      | 3.96      | n/a        | 9.56       |
| whisper-large-v3-turbo | final | CPU only (`CUDA_VISIBLE_DEVICES=-1`) | 0.199 | 100%      | 3.98      | 5          | 10.08      |
| whisper-small-en       | final | GPU requested                        | 0.225 | 87%       | 3.99      | 3          | 1.15       |
| whisper-small-en       | final | CPU only (`CUDA_VISIBLE_DEVICES=-1`) | 0.225 | 87%       | 4.00      | 3          | 1.14       |

Idle (Silero VAD on silence, as in Always mode, 60 s): 0.004 cores. This is the ears loop only;
the wake word model comes in V5.

Notes on the numbers, nothing rounded away:

- **The GPU never ran.** Both "GPU requested" rows logged "the graphics card could not run the
  final speech model; using the processor" and decoded on the CPU, hence the same speed as the
  CPU-only rows. CTranslate2 sees the card (`get_cuda_device_count()` is 1), but `cublas64_12.dll`,
  `cudnn64_9.dll` and `cudart64_12.dll` cannot be loaded here (no CUDA toolkit, and V2 dropped the
  `nvidia-*` wheels). So there is no GPU speed for Whisper turbo on this machine. That is a
  result, and the fallback worked as designed.
- The "GPU peak %" for Moonshine (21, 16, 3) is the desktop and other programs; Moonshine runs
  on the CPU through ONNX. Moonshine was therefore measured once.
- Moonshine used about 15 cores' worth of CPU time while decoding and Whisper about 4; both
  bursts, since they only run while a turn is being decoded.
- WER differences of about 0.01 (0.193 against 0.199) are one or two words over the corpus, not a
  real ranking. Turbo (0.199) is not better than Moonshine small or medium (0.193, 0.199) here.
- One run per cell; no repeat to estimate noise.
- **The WER numbers carry a bias.** The corpus references spell numbers out ("two thousand twenty
  six", "three hundred and forty seven times twelve") and Whisper writes digits, so Whisper was
  scored as wrong on words it got right. Turbo and small.en were probably penalised on the 2
  number lines out of 5. The scorer now reads spelled-out numbers as digits; the numbers above
  were measured before that and were not re-run. The GPU re-run in V3b will re-score them.
- Not built (YAGNI): the optional nemotron and parakeet candidates, and a search for existing WAVs
  on the PC to use as clips.

## Decision

The plan guessed turbo as the final model everywhere and tiny as the live default. The numbers
disagree with parts of that:

- **Auto live is `moonshine-small`.** It had the best WER (0.193), kept the name on every clip,
  and costs a 120 MB download. Tiny is worse (0.238, name kept 87%); medium is not better and is
  slower. Live words are a preview, so cost matters more than the last point of WER.
- **Auto final is `whisper-large-v3-turbo` only when a usable graphics card is found; otherwise no
  final pass.** On the CPU turbo takes about 10 s after the end of a turn, which is too slow for
  a conversation, and `whisper-small-en` takes 1.1 s but hears worse than Moonshine small
  (0.225 against 0.193), so it would make the transcript worse. The turbo-on-GPU choice is
  **not measured yet**: this PC could not run the GPU. V3b now fetches the NVIDIA libraries on
  demand; the GPU row comes after the live run of the harness on this PC. It stays the plan's pick for a PC with a card
  and CUDA libraries, and the harness is how to check it there.
- **The GPU probe needs the libraries, not only the card.** `detect_hardware` counts CUDA devices
  through CTranslate2 (so a PC with a driver but no toolkit is seen, and `CUDA_VISIBLE_DEVICES=-1`
  hides the card) and also requires cuBLAS and cuDNN to be found (on the system, or in `<TAGALONG_HOME>/voice/cuda`, where V3b fetches them). Without it, this PC would have been told
  "GPU", loaded turbo, fallen back to a 10 s CPU decode on every turn. The old probe looked for
  `cudart64_12` and missed this card entirely.
- The final model is chosen by the `auto` hints in `stt_models.json`; changing the rule is a data
  change plus a re-run, not a code change.

Open: a re-run on a PC with the CUDA libraries (to confirm turbo's speed on a card), and on
real recorded clips of the person (`--clips`).

## Re-run

From `brain/`, one model at a time (the first run downloads the models, about 2.5 GB in all, into
`<TAGALONG_HOME>/voice`):

```
uv run python -m tools.stt_bench --models moonshine-tiny
uv run python -m tools.stt_bench --models moonshine-small --idle-seconds 0
uv run python -m tools.stt_bench --models moonshine-medium --idle-seconds 0
uv run python -m tools.stt_bench --models whisper-large-v3-turbo --idle-seconds 0
uv run python -m tools.stt_bench --models whisper-small-en --idle-seconds 0
```

For the CPU-only case set `CUDA_VISIBLE_DEVICES=-1` for the Whisper runs (PowerShell:
`$env:CUDA_VISIBLE_DEVICES="-1"`). Add `--clips DIR` for your own recordings (`name.wav` beside
`name.txt`), `--no-kokoro` to use only those, and `--snr 100` for no added noise.
