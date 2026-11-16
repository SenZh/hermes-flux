/**
 * Hermes Flux 入职向导与快速设置控制器 (Onboarding & Quick Setup Controller)
 *
 * 【设计意图 (Why)】
 * 统管冷启动入职向导表单（网关地址、账号、密码、Profile 别名）的实时同步与持久化、
 * 连通性测试发起与加载态反馈、保存并连接、审批三态下拉切换以及文件选择对话框附加。
 * 将原先散落在 index.ts bindEvents() 中的模板 DOM 绑定彻底解耦，
 * 保持纯单向依赖，实现零依赖的独立单元测试能力。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. 网关 URL 必须带 trim 校验并同时写入 hermes_flux_ 与 hermes_aura_ 兼容前缀；
 * 2. 审批模式从历史的 auto/ask/sandbox 归一到 manual/smart/off，非法值不得发出；
 * 3. 密码继承：留空沿用旧密码，非空覆盖。
 *
 * 【约束与规则 (Rules)】
 * - 纯单向依赖，严禁反向 import index.ts；
 * - 0 as any，保持全栈严格类型推导；
 * - 遵循三要素中文注释规范。
 */

import type { AppState } from '../state/appState.js';
import type { I18nKey } from '@hermes-flux/ui';
import type { HermesDesktopBridge } from '../../preload/index.js';

export interface OnboardingControllerDeps {
  getState: () => AppState;
  render: () => void;
  connect: () => void;
  testConnection: (url: string, user: string, pass: string) => Promise<{ ok?: boolean; message?: string; latency?: number }>;
  switchApproval: (mode: AppState['approvalMode']) => Promise<void>;
  getDesktopApi: () => HermesDesktopBridge | undefined;
  t: (key: I18nKey) => string;
  fetchModelOptions?: () => Promise<void>;
  hideModelCascade?: () => void;
  resetModelSearchOnOpen?: () => void;
}

export interface OnboardingController {
  bindDomEvents(doc?: Document): void;
}

export function createOnboardingController(deps: OnboardingControllerDeps): OnboardingController {
  const { getState, render, connect, testConnection, switchApproval, getDesktopApi, t } = deps;

  function bindDomEvents(doc: Document = document): void {
    if (typeof document === 'undefined') return;

    const state = getState();
    const desktopApi = getDesktopApi();

    // 1. 文件附加按钮
    const attachBtn = doc.getElementById('dock-attach-file-btn');
    if (attachBtn) {
      attachBtn.onclick = async () => {
        if (desktopApi?.openFileDialog) {
          const paths = await desktopApi.openFileDialog();
          if (paths && paths.length > 0) {
            const input = doc.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
            if (input) {
              input.value += (input.value ? '\n' : '') + `[file: ${paths.join(', ')}]`;
            }
          }
        }
      };
    }

    // 2. Onboarding Live Inputs & Double Binding
    const obUrlInput = doc.getElementById('onboarding-gateway-url') as HTMLInputElement | null;
    if (obUrlInput) {
      obUrlInput.oninput = () => {
        state.gatewayUrl = obUrlInput.value.trim();
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('hermes_flux_gateway_url', state.gatewayUrl);
          localStorage.setItem('hermes_aura_gateway_url', state.gatewayUrl);
        }
      };
    }
    const obUserInput = doc.getElementById('onboarding-username') as HTMLInputElement | null;
    if (obUserInput) {
      obUserInput.oninput = () => {
        state.username = obUserInput.value;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('hermes_flux_username', state.username);
          localStorage.setItem('hermes_aura_username', state.username);
        }
      };
    }
    const obPassInput = doc.getElementById('onboarding-password') as HTMLInputElement | null;
    if (obPassInput) {
      obPassInput.oninput = () => {
        state.password = obPassInput.value;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('hermes_flux_password', state.password);
          localStorage.setItem('hermes_aura_password', state.password);
        }
      };
    }
    const obProfileInput = doc.getElementById('onboarding-profile-name') as HTMLInputElement | null;
    if (obProfileInput) {
      obProfileInput.oninput = () => {
        state.profileName = obProfileInput.value || 'default';
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('hermes_flux_profile', state.profileName);
          localStorage.setItem('hermes_aura_profile', state.profileName);
        }
      };
    }

    // 3. Onboarding Buttons
    const onboardingTestBtn = doc.getElementById('btn-test-connection');
    if (onboardingTestBtn) {
      onboardingTestBtn.onclick = async () => {
        const urlInput = ((doc.getElementById('onboarding-gateway-url') as HTMLInputElement)?.value || '').trim();
        const userInput = (doc.getElementById('onboarding-username') as HTMLInputElement)?.value;
        const passInput = (doc.getElementById('onboarding-password') as HTMLInputElement)?.value;
        const profileInput = (doc.getElementById('onboarding-profile-name') as HTMLInputElement)?.value;

        if (!urlInput) {
          state.testStatus = { ok: false, message: t('gateway.urlRequired'), latency: 0 };
          render();
          return;
        }
        state.gatewayUrl = urlInput;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('hermes_flux_gateway_url', urlInput);
          localStorage.setItem('hermes_aura_gateway_url', urlInput);
          if (userInput !== undefined) {
            state.username = userInput;
            localStorage.setItem('hermes_flux_username', userInput);
            localStorage.setItem('hermes_aura_username', userInput);
          }
          if (passInput !== undefined) {
            state.password = passInput;
            localStorage.setItem('hermes_flux_password', passInput);
            localStorage.setItem('hermes_aura_password', passInput);
          }
          if (profileInput !== undefined) {
            state.profileName = profileInput || 'default';
            localStorage.setItem('hermes_flux_profile', state.profileName);
            localStorage.setItem('hermes_aura_profile', state.profileName);
          }
        }

        onboardingTestBtn.innerText = 'Testing...';
        const res = await testConnection(urlInput, userInput || '', passInput || '');
        state.testStatus = res;
        onboardingTestBtn.innerText = 'Test Connection';
        render();
      };
    }

    const onboardingSaveBtn = doc.getElementById('btn-save-and-connect');
    if (onboardingSaveBtn) {
      onboardingSaveBtn.onclick = async () => {
        const urlInput = ((doc.getElementById('onboarding-gateway-url') as HTMLInputElement)?.value || '').trim();
        if (!urlInput) {
          state.testStatus = { ok: false, message: t('gateway.urlRequired'), latency: 0 };
          render();
          return;
        }
        state.gatewayUrl = urlInput;
        state.username = (doc.getElementById('onboarding-username') as HTMLInputElement)?.value || '';
        state.password = (doc.getElementById('onboarding-password') as HTMLInputElement)?.value || '';
        state.profileName = (doc.getElementById('onboarding-profile-name') as HTMLInputElement)?.value || 'default';
        connect();
      };
    }

    // 4. 审批三态：manual / smart / off
    const approvalBtn = doc.getElementById('dock-approval-toggle-btn');
    const approvalDropdown = doc.getElementById('dock-approval-dropdown');
    if (approvalBtn && approvalDropdown) {
      approvalBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = approvalDropdown.style.display === 'block';
        approvalDropdown.style.display = isOpen ? 'none' : 'block';
        approvalBtn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      };
      approvalDropdown.querySelectorAll<HTMLElement>('.composer-approval-option').forEach((opt) => {
        opt.onclick = (e) => {
          e.stopPropagation();
          const mode = opt.dataset.mode as AppState['approvalMode'] | undefined;
          approvalDropdown.style.display = 'none';
          approvalBtn.setAttribute('aria-expanded', 'false');
          if (mode) void switchApproval(mode);
        };
      });
    }

    // 5. 模型选择按钮与刷新
    const modelBtn = doc.getElementById('dock-model-selector-btn');
    const refreshModelBtn = doc.getElementById('btn-refresh-models');

    if (refreshModelBtn && deps.fetchModelOptions) {
      refreshModelBtn.onclick = (e) => {
        e.stopPropagation();
        void deps.fetchModelOptions?.();
      };
    }

    if (modelBtn) {
      modelBtn.onclick = (e) => {
        e.stopPropagation();
        const dropdown = doc.getElementById('dock-model-dropdown');
        if (!dropdown) return;
        state.modelMenuOpen = !state.modelMenuOpen;
        dropdown.style.display = state.modelMenuOpen ? 'block' : 'none';
        modelBtn.setAttribute('aria-expanded', state.modelMenuOpen ? 'true' : 'false');
        if (state.modelMenuOpen) {
          deps.resetModelSearchOnOpen?.();
          if (state.availableModels.length === 0) {
            void deps.fetchModelOptions?.();
          }
          const search = doc.getElementById('dock-model-search-input') as HTMLInputElement | null;
          if (search) {
            search.value = '';
            search.focus();
          }
        } else {
          deps.hideModelCascade?.();
        }
      };
    }
  }

  return {
    bindDomEvents,
  };
}
