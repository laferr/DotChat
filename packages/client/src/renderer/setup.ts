// 첫 실행 프로필 설정 창

(() => {
  const nickInput = document.getElementById('nick-input') as HTMLInputElement;
  const tagInput = document.getElementById('tag-input') as HTMLInputElement;
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const errorEl = document.getElementById('error')!;
  const closeBtn = document.getElementById('close-btn') as HTMLButtonElement;

  function isValid(): boolean {
    return nickInput.value.trim().length > 0 && /^\d{4}$/.test(tagInput.value);
  }

  function refresh(): void {
    startBtn.disabled = !isValid();
  }

  tagInput.addEventListener('input', () => {
    tagInput.value = tagInput.value.replace(/\D/g, '').slice(0, 4);
    refresh();
  });
  nickInput.addEventListener('input', refresh);

  async function submit(): Promise<void> {
    if (!isValid()) return;
    startBtn.disabled = true;
    const result = (await window.overlay.submitProfile({
      nickname: nickInput.value.trim(),
      tag: tagInput.value,
    })) as { ok: boolean; error?: string };
    if (!result.ok) {
      errorEl.textContent = result.error ?? '저장에 실패했습니다.';
      refresh();
    }
  }

  for (const input of [nickInput, tagInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        void submit();
      }
    });
  }
  startBtn.addEventListener('click', () => void submit());
  closeBtn.addEventListener('click', () => window.overlay.cancelSetup());

  nickInput.focus();
})();
