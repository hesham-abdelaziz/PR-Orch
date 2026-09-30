import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet } from '@angular/router';
import { SidebarComponent } from './sidebar.component';
import { TopStatusBarComponent } from './top-status-bar.component';
import { AuthStore } from '../core/auth/auth.store';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, TopStatusBarComponent],
  template: `
    <div class="shell-layout">
      <app-sidebar />
      <div class="shell-content-wrapper">
        <app-top-status-bar
          [username]="authStore.username()"
          (logout)="onLogout()"
        />
        <main class="main-viewport" tabindex="-1">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [`
    @use '../../styles/tokens' as *;

    .shell-layout {
      display: flex;
      height: 100vh;
      width: 100%;
      min-width: 1024px;
      overflow: hidden;
      background-color: $bg-canvas;
    }

    .shell-content-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    .main-viewport {
      flex: 1;
      overflow-y: auto;
      background-color: $bg-canvas;
      padding: 0;
      outline: none;
    }
  `],
})
export class AppShellComponent {
  readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  async onLogout(): Promise<void> {
    await this.authStore.logout();
    await this.router.navigate(['/auth/login']);
  }
}
