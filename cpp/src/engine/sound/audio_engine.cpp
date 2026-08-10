/// @file audio_engine.cpp
/// Implementation XAudio2 du backend audio.
/// Reference RE : audio_criatom_init.c.

#include "iecode/engine/sound/audio_engine.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstring>

#ifdef _WIN32
#  include <windows.h>
#  include <objbase.h>
#  include <xaudio2.h>
#  include <x3daudio.h>
#endif

namespace lives {

AudioEngine& AudioEngine::get() {
    static AudioEngine instance;
    return instance;
}

AudioEngine::~AudioEngine() {
    shutdown();
}

bool AudioEngine::init() {
    if (initialized_) {
        return true;
    }

#ifdef _WIN32
    // COM multi-thread (XAudio2 l'exige).
    const HRESULT co_hr = ::CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (co_hr == S_OK || co_hr == S_FALSE) {
        com_initialized_ = (co_hr == S_OK);
    } else if (co_hr == RPC_E_CHANGED_MODE) {
        // Deja initialise dans un autre mode — on continue sans ownership.
        com_initialized_ = false;
    } else {
        spdlog::error("AudioEngine: CoInitializeEx a echoue (hr=0x{:08X})",
                      static_cast<uint32_t>(co_hr));
        return false;
    }

    HRESULT hr = ::XAudio2Create(&xaudio2_, 0, XAUDIO2_DEFAULT_PROCESSOR);
    if (FAILED(hr)) {
        spdlog::error("AudioEngine: XAudio2Create a echoue (hr=0x{:08X})",
                      static_cast<uint32_t>(hr));
        if (com_initialized_) {
            ::CoUninitialize();
            com_initialized_ = false;
        }
        return false;
    }

    hr = xaudio2_->CreateMasteringVoice(&master_, XAUDIO2_DEFAULT_CHANNELS);
    if (FAILED(hr)) {
        spdlog::error("AudioEngine: CreateMasteringVoice a echoue (hr=0x{:08X})",
                      static_cast<uint32_t>(hr));
        xaudio2_->Release();
        xaudio2_ = nullptr;
        if (com_initialized_) {
            ::CoUninitialize();
            com_initialized_ = false;
        }
        return false;
    }

    // Recupere la geometrie de sortie pour configurer X3DAudio.
    XAUDIO2_VOICE_DETAILS details{};
    master_->GetVoiceDetails(&details);
    output_channels_ = details.InputChannels;

    DWORD channel_mask = 0;
    if (SUCCEEDED(master_->GetChannelMask(&channel_mask)) && channel_mask != 0) {
        output_channel_mask_ = static_cast<float>(channel_mask);
        const HRESULT x3d_hr = ::X3DAudioInitialize(
            channel_mask,
            X3DAUDIO_SPEED_OF_SOUND,
            reinterpret_cast<X3DAUDIO_HANDLE&>(*x3d_instance_.data()));
        x3d_initialized_ = SUCCEEDED(x3d_hr);
        if (!x3d_initialized_) {
            spdlog::warn("AudioEngine: X3DAudioInitialize a echoue (hr=0x{:08X}) — audio 3D desactive",
                         static_cast<uint32_t>(x3d_hr));
        }
    } else {
        spdlog::warn("AudioEngine: GetChannelMask=0 — audio 3D desactive");
    }

    initialized_ = true;
    spdlog::info("AudioEngine: XAudio2 initialise ({} canaux sortie, X3DAudio={})",
                 output_channels_, x3d_initialized_ ? "ok" : "off");
    return true;
#else
    spdlog::warn("AudioEngine: plateforme non-Windows, backend audio desactive");
    initialized_ = true; // stub "ok"
    return true;
#endif
}

void AudioEngine::shutdown() {
    if (!initialized_) {
        return;
    }

#ifdef _WIN32
    // Detruire toutes les voices actives.
    for (auto& slot : slots_) {
        if (slot.voice) {
            slot.voice->Stop(0);
            slot.voice->DestroyVoice();
            slot.voice = nullptr;
        }
    }
    slots_.clear();

    if (master_) {
        master_->DestroyVoice();
        master_ = nullptr;
    }
    if (xaudio2_) {
        xaudio2_->Release();
        xaudio2_ = nullptr;
    }
    if (com_initialized_) {
        ::CoUninitialize();
        com_initialized_ = false;
    }
    x3d_initialized_ = false;
    x3d_instance_.fill(0);
#endif

    initialized_ = false;
    spdlog::info("AudioEngine: arrete");
}

AudioEngine::SoundHandle AudioEngine::play_pcm(const int16_t* samples,
                                               uint32_t       frame_count,
                                               uint32_t       sample_rate,
                                               uint32_t       channels,
                                               float          volume,
                                               bool           loop) {
    if (!initialized_ || samples == nullptr || frame_count == 0 || channels == 0) {
        return {};
    }

#ifdef _WIN32
    if (!xaudio2_) {
        return {};
    }

    // Format PCM 16-bit standard.
    WAVEFORMATEX wfx = {};
    wfx.wFormatTag      = WAVE_FORMAT_PCM;
    wfx.nChannels       = static_cast<WORD>(channels);
    wfx.nSamplesPerSec  = sample_rate;
    wfx.wBitsPerSample  = 16;
    wfx.nBlockAlign     = static_cast<WORD>(channels * sizeof(int16_t));
    wfx.nAvgBytesPerSec = sample_rate * wfx.nBlockAlign;
    wfx.cbSize          = 0;

    VoiceSlot slot;
    slot.id   = next_id_++;
    slot.loop = loop;

    // Copier les echantillons — le slot possede le buffer, XAudio2 lit
    // le pointeur de maniere asynchrone.
    const size_t total_samples = static_cast<size_t>(frame_count) * channels;
    slot.buffer.resize(total_samples);
    std::memcpy(slot.buffer.data(), samples, total_samples * sizeof(int16_t));

    HRESULT hr = xaudio2_->CreateSourceVoice(&slot.voice, &wfx);
    if (FAILED(hr) || !slot.voice) {
        spdlog::error("AudioEngine: CreateSourceVoice a echoue (hr=0x{:08X})",
                      static_cast<uint32_t>(hr));
        return {};
    }

    XAUDIO2_BUFFER buffer = {};
    buffer.AudioBytes = static_cast<UINT32>(slot.buffer.size() * sizeof(int16_t));
    buffer.pAudioData = reinterpret_cast<const BYTE*>(slot.buffer.data());
    buffer.Flags      = XAUDIO2_END_OF_STREAM;
    buffer.LoopCount  = loop ? XAUDIO2_LOOP_INFINITE : 0;

    hr = slot.voice->SubmitSourceBuffer(&buffer);
    if (FAILED(hr)) {
        spdlog::error("AudioEngine: SubmitSourceBuffer a echoue (hr=0x{:08X})",
                      static_cast<uint32_t>(hr));
        slot.voice->DestroyVoice();
        return {};
    }

    slot.voice->SetVolume(std::clamp(volume, 0.0f, 1.0f));

    hr = slot.voice->Start(0);
    if (FAILED(hr)) {
        spdlog::error("AudioEngine: Start a echoue (hr=0x{:08X})",
                      static_cast<uint32_t>(hr));
        slot.voice->DestroyVoice();
        return {};
    }

    const SoundHandle handle{ slot.id };
    slots_.push_back(std::move(slot));
    return handle;
#else
    (void)sample_rate; (void)volume; (void)loop;
    return {};
#endif
}

AudioEngine::SoundHandle AudioEngine::play_pcm_3d(const int16_t* samples,
                                                  uint32_t       frame_count,
                                                  uint32_t       sample_rate,
                                                  uint32_t       channels,
                                                  AudioVec3      position,
                                                  float          volume,
                                                  bool           loop) {
    // Reuse play_pcm pour soumettre la voice, puis on patche le slot pour
    // marquer comme 3D et appliquer X3DAudio.
    const SoundHandle handle = play_pcm(samples, frame_count, sample_rate,
                                        channels, volume, loop);
    if (!handle.valid()) return handle;

#ifdef _WIN32
    for (auto& slot : slots_) {
        if (slot.id == handle.id) {
            slot.is_3d       = true;
            slot.channels    = channels;
            slot.sample_rate = sample_rate;
            slot.position    = position;
            apply_3d(slot);
            break;
        }
    }
#else
    (void)position;
#endif
    return handle;
}

void AudioEngine::set_listener(const AudioListener& listener) {
    listener_ = listener;
#ifdef _WIN32
    if (!x3d_initialized_) return;
    for (auto& slot : slots_) {
        if (slot.is_3d && slot.voice) {
            apply_3d(slot);
        }
    }
#endif
}

void AudioEngine::set_voice_position(SoundHandle handle, AudioVec3 position) {
    if (!handle.valid()) return;
#ifdef _WIN32
    for (auto& slot : slots_) {
        if (slot.id == handle.id && slot.voice) {
            slot.position = position;
            slot.is_3d    = true;
            apply_3d(slot);
            return;
        }
    }
#else
    (void)position;
#endif
}

#ifdef _WIN32
void AudioEngine::apply_3d(VoiceSlot& slot) {
    if (!x3d_initialized_ || !slot.voice || !master_) return;

    X3DAUDIO_LISTENER l{};
    l.Position    = { listener_.position.x, listener_.position.y, listener_.position.z };
    l.OrientFront = { listener_.forward.x,  listener_.forward.y,  listener_.forward.z  };
    l.OrientTop   = { listener_.up.x,       listener_.up.y,       listener_.up.z       };
    l.Velocity    = { listener_.velocity.x, listener_.velocity.y, listener_.velocity.z };

    X3DAUDIO_EMITTER e{};
    e.Position          = { slot.position.x, slot.position.y, slot.position.z };
    e.OrientFront       = { 0.f, 0.f, 1.f };
    e.OrientTop         = { 0.f, 1.f, 0.f };
    e.ChannelCount      = 1; // emis comme source mono pour le mix 3D
    e.ChannelRadius     = 0.f;
    e.CurveDistanceScaler = 1.f;
    e.DopplerScaler     = 1.f;
    e.InnerRadius       = 0.f;
    e.InnerRadiusAngle  = 0.f;

    // Le DSP a besoin d'une matrice [src_channels x dst_channels].
    // Limite raisonnable a 8 canaux de sortie (7.1).
    constexpr UINT32 kMaxOut = 8;
    float matrix[kMaxOut] = {};

    X3DAUDIO_DSP_SETTINGS dsp{};
    dsp.SrcChannelCount     = 1;
    dsp.DstChannelCount     = output_channels_ < kMaxOut ? output_channels_ : kMaxOut;
    dsp.pMatrixCoefficients = matrix;

    ::X3DAudioCalculate(
        reinterpret_cast<const X3DAUDIO_HANDLE&>(*x3d_instance_.data()),
        &l, &e,
        X3DAUDIO_CALCULATE_MATRIX | X3DAUDIO_CALCULATE_DOPPLER,
        &dsp);

    // Applique la matrice de mix au voice (1 source channel -> N output).
    slot.voice->SetOutputMatrix(master_, 1, dsp.DstChannelCount, matrix);
    slot.voice->SetFrequencyRatio(dsp.DopplerFactor > 0.f ? dsp.DopplerFactor : 1.f);
}
#endif

void AudioEngine::stop(SoundHandle handle) {
    if (!handle.valid()) return;

#ifdef _WIN32
    auto it = std::find_if(slots_.begin(), slots_.end(),
                           [&](const VoiceSlot& s) { return s.id == handle.id; });
    if (it == slots_.end()) return;

    if (it->voice) {
        it->voice->Stop(0);
        it->voice->FlushSourceBuffers();
        it->voice->DestroyVoice();
        it->voice = nullptr;
    }
    slots_.erase(it);
#endif
}

void AudioEngine::set_volume(SoundHandle handle, float volume) {
    if (!handle.valid()) return;

#ifdef _WIN32
    for (auto& slot : slots_) {
        if (slot.id == handle.id && slot.voice) {
            slot.voice->SetVolume(std::clamp(volume, 0.0f, 1.0f));
            return;
        }
    }
#else
    (void)volume;
#endif
}

void AudioEngine::set_master_volume(float volume) {
#ifdef _WIN32
    if (master_) {
        master_->SetVolume(std::clamp(volume, 0.0f, 1.0f));
    }
#else
    (void)volume;
#endif
}

bool AudioEngine::is_playing(SoundHandle handle) const {
    if (!handle.valid()) return false;

#ifdef _WIN32
    for (const auto& slot : slots_) {
        if (slot.id == handle.id && slot.voice) {
            XAUDIO2_VOICE_STATE state{};
            slot.voice->GetState(&state);
            return state.BuffersQueued > 0;
        }
    }
#endif
    return false;
}

void AudioEngine::update() {
    if (!initialized_) return;

#ifdef _WIN32
    // Purger les voices dont tous les buffers sont consommes (et non-loop).
    slots_.erase(
        std::remove_if(slots_.begin(), slots_.end(),
            [](VoiceSlot& slot) {
                if (!slot.voice) return true;
                if (slot.loop) return false;

                XAUDIO2_VOICE_STATE state{};
                slot.voice->GetState(&state);
                if (state.BuffersQueued == 0) {
                    slot.voice->DestroyVoice();
                    slot.voice = nullptr;
                    return true;
                }
                return false;
            }),
        slots_.end());
#endif
}

} // namespace lives
