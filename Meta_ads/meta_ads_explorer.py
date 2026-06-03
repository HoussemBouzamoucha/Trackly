import tkinter as tk
from tkinter import ttk, messagebox
import urllib.request
import urllib.parse
import json
import threading

ACCOUNTS = [
    {"name": "OJ1",     "id": "act_386398953885409"},
    {"name": "AJ1",     "id": "act_420352014017891"},
    {"name": "Velmora", "id": "act_2664733963891198"},
    {"name": "SHOPI T", "id": "act_2099928840772443"},
    {"name": "TUNSHOP", "id": "act_838301375930345"},
]

ENDPOINTS = [
    {"label": "Account info",  "path": "",           "default_fields": "name,account_status,currency,timezone_name,amount_spent"},
    {"label": "Campaigns",     "path": "/campaigns", "default_fields": "name,status,objective,daily_budget,lifetime_budget"},
    {"label": "Ad sets",       "path": "/adsets",    "default_fields": "name,status,daily_budget,start_time,end_time"},
    {"label": "Ads",           "path": "/ads",       "default_fields": "name,status,adset_id"},
    {"label": "Insights",      "path": "/insights",  "default_fields": "impressions,clicks,spend,ctr,cpc,reach"},
    {"label": "Product Spend", "path": "/insights",  "default_fields": "spend,impressions,clicks,ctr,cpc",
     "extra_params": {"breakdowns": "product_id", "level": "ad", "date_preset": "last_30d"}},
]

BASE_URL = "https://graph.facebook.com/v19.0"


class MetaAdsExplorer(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Meta Ads Explorer")
        self.geometry("900x680")
        self.minsize(750, 560)
        self.configure(bg="#f5f5f0")
        self.token = ""
        self.selected_account = ACCOUNTS[0]
        self.selected_endpoint = ENDPOINTS[0]
        self._build_ui()

    def _build_ui(self):
        pad = {"padx": 16, "pady": 0}

        # Title
        title_frame = tk.Frame(self, bg="#f5f5f0")
        title_frame.pack(fill="x", padx=16, pady=(16, 4))
        tk.Label(title_frame, text="Meta Ads Explorer", font=("Helvetica", 16, "bold"), bg="#f5f5f0", fg="#1a1a1a").pack(side="left")
        tk.Label(title_frame, text="Read-only GET requests · Marketing API v19.0", font=("Helvetica", 11), bg="#f5f5f0", fg="#888").pack(side="left", padx=(10, 0))
        ttk.Separator(self, orient="horizontal").pack(fill="x", padx=16, pady=8)

        # Token
        token_frame = tk.Frame(self, bg="#f5f5f0")
        token_frame.pack(fill="x", padx=16, pady=(0, 10))
        tk.Label(token_frame, text="Access token", font=("Helvetica", 11), bg="#f5f5f0", fg="#555", width=12, anchor="w").pack(side="left")
        self.token_var = tk.StringVar()
        self.token_entry = tk.Entry(token_frame, textvariable=self.token_var, font=("Helvetica", 11), show="", relief="flat", bg="white", fg="#1a1a1a", insertbackground="#1a1a1a", highlightthickness=1, highlightbackground="#d0d0c8", highlightcolor="#534AB7")
        self.token_entry.pack(side="left", fill="x", expand=True, ipady=5, padx=(0, 8))
        self.token_entry.bind("<Return>", lambda e: self._set_token())
        tk.Button(token_frame, text="Set token", command=self._set_token, font=("Helvetica", 11), bg="#534AB7", fg="white", relief="flat", padx=14, pady=5, cursor="hand2", activebackground="#3C3489", activeforeground="white").pack(side="left")
        self.token_status = tk.Label(token_frame, text="", font=("Helvetica", 10), bg="#f5f5f0", fg="#888")
        self.token_status.pack(side="left", padx=(10, 0))

        # Accounts
        tk.Label(self, text="Ad account", font=("Helvetica", 11), bg="#f5f5f0", fg="#555", anchor="w").pack(fill="x", padx=16, pady=(0, 4))
        acc_frame = tk.Frame(self, bg="#f5f5f0")
        acc_frame.pack(fill="x", padx=16, pady=(0, 12))
        self.acc_buttons = []
        for i, acc in enumerate(ACCOUNTS):
            btn = tk.Button(acc_frame, text=f"{acc['name']}\n{acc['id']}", font=("Helvetica", 10), relief="flat", cursor="hand2", bg="white", fg="#1a1a1a", highlightthickness=1, highlightbackground="#d0d0c8", padx=10, pady=6, command=lambda idx=i: self._select_account(idx))
            btn.pack(side="left", padx=(0, 8))
            self.acc_buttons.append(btn)

        # Endpoints
        tk.Label(self, text="Endpoint", font=("Helvetica", 11), bg="#f5f5f0", fg="#555", anchor="w").pack(fill="x", padx=16, pady=(0, 4))
        ep_frame = tk.Frame(self, bg="#f5f5f0")
        ep_frame.pack(fill="x", padx=16, pady=(0, 12))
        self.ep_buttons = []
        for i, ep in enumerate(ENDPOINTS):
            btn = tk.Button(ep_frame, text=ep["label"], font=("Helvetica", 10), relief="flat", cursor="hand2", bg="white", fg="#555", highlightthickness=1, highlightbackground="#d0d0c8", padx=12, pady=5, command=lambda idx=i: self._select_endpoint(idx))
            btn.pack(side="left", padx=(0, 8))
            self.ep_buttons.append(btn)

        # Fields
        fields_frame = tk.Frame(self, bg="#f5f5f0")
        fields_frame.pack(fill="x", padx=16, pady=(0, 8))
        tk.Label(fields_frame, text="Fields", font=("Helvetica", 11), bg="#f5f5f0", fg="#555", width=12, anchor="w").pack(side="left")
        self.fields_var = tk.StringVar()
        self.fields_entry = tk.Entry(fields_frame, textvariable=self.fields_var, font=("Courier", 11), relief="flat", bg="white", fg="#1a1a1a", insertbackground="#1a1a1a", highlightthickness=1, highlightbackground="#d0d0c8", highlightcolor="#534AB7")
        self.fields_entry.pack(side="left", fill="x", expand=True, ipady=5)
        self.fields_var.trace_add("write", lambda *_: self._update_preview())

        # URL preview
        preview_frame = tk.Frame(self, bg="#f5f5f0")
        preview_frame.pack(fill="x", padx=16, pady=(0, 10))
        tk.Label(preview_frame, text="URL", font=("Helvetica", 11), bg="#f5f5f0", fg="#555", width=12, anchor="w").pack(side="left")
        self.url_preview = tk.Label(preview_frame, text="", font=("Courier", 10), bg="#f5f5f0", fg="#888", anchor="w", wraplength=700, justify="left")
        self.url_preview.pack(side="left", fill="x", expand=True)

        # Fetch button
        fetch_frame = tk.Frame(self, bg="#f5f5f0")
        fetch_frame.pack(fill="x", padx=16, pady=(0, 12))
        self.fetch_btn = tk.Button(fetch_frame, text="⟳  Fetch", font=("Helvetica", 12, "bold"), bg="#534AB7", fg="white", relief="flat", padx=20, pady=7, cursor="hand2", activebackground="#3C3489", activeforeground="white", command=self._fetch)
        self.fetch_btn.pack(side="left")
        self.status_label = tk.Label(fetch_frame, text="", font=("Helvetica", 11), bg="#f5f5f0", fg="#888")
        self.status_label.pack(side="left", padx=(14, 0))

        # Result
        result_label_frame = tk.Frame(self, bg="#f5f5f0")
        result_label_frame.pack(fill="x", padx=16, pady=(0, 4))
        tk.Label(result_label_frame, text="Response", font=("Helvetica", 11), bg="#f5f5f0", fg="#555").pack(side="left")
        self.resp_status = tk.Label(result_label_frame, text="", font=("Helvetica", 10), bg="#f5f5f0", fg="#888")
        self.resp_status.pack(side="left", padx=(10, 0))

        result_outer = tk.Frame(self, bg="white", highlightthickness=1, highlightbackground="#d0d0c8")
        result_outer.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        scrollbar = tk.Scrollbar(result_outer)
        scrollbar.pack(side="right", fill="y")
        self.result_text = tk.Text(result_outer, font=("Courier", 11), bg="white", fg="#1a1a1a", relief="flat", wrap="word", state="disabled", yscrollcommand=scrollbar.set, padx=12, pady=10)
        self.result_text.pack(fill="both", expand=True)
        scrollbar.config(command=self.result_text.yview)

        self._set_result("Select an account and endpoint, then click Fetch.", color="#888")
        self._select_account(0)
        self._select_endpoint(0)
        self._update_preview()

    def _set_token(self):
        val = self.token_var.get().strip()
        if not val:
            messagebox.showwarning("No token", "Please enter your Meta access token.")
            return
        self.token = val
        self.token_entry.config(show="•")
        self.token_status.config(text="✓ Token set", fg="#2e7d32")
        self._update_preview()

    def _select_account(self, idx):
        self.selected_account = ACCOUNTS[idx]
        for i, btn in enumerate(self.acc_buttons):
            if i == idx:
                btn.config(bg="#EDE9FD", fg="#534AB7", highlightbackground="#534AB7")
            else:
                btn.config(bg="white", fg="#1a1a1a", highlightbackground="#d0d0c8")
        self._update_preview()

    def _select_endpoint(self, idx):
        self.selected_endpoint = ENDPOINTS[idx]
        for i, btn in enumerate(self.ep_buttons):
            if i == idx:
                btn.config(bg="#EDE9FD", fg="#534AB7", highlightbackground="#534AB7")
            else:
                btn.config(bg="white", fg="#555", highlightbackground="#d0d0c8")
        self.fields_var.set(self.selected_endpoint["default_fields"])
        self._update_preview()

    def _build_url(self, mask_token=False):
        fields = self.fields_var.get().strip() or self.selected_endpoint["default_fields"]
        token_part = "••••" if mask_token else (self.token or "{token}")
        query = {"fields": fields, "access_token": token_part}
        query.update(self.selected_endpoint.get("extra_params", {}))
        params = urllib.parse.urlencode(query)
        return f"{BASE_URL}/{self.selected_account['id']}{self.selected_endpoint['path']}?{params}"

    def _update_preview(self):
        self.url_preview.config(text=self._build_url(mask_token=True))

    def _fetch(self):
        if not self.token:
            messagebox.showwarning("No token", "Please set your access token first.")
            return
        self.fetch_btn.config(state="disabled", text="Fetching…")
        self.status_label.config(text="", fg="#888")
        self.resp_status.config(text="loading…", fg="#1565C0")
        self._set_result("Fetching…", color="#888")
        threading.Thread(target=self._do_fetch, daemon=True).start()

    def _do_fetch(self):
        url = self._build_url(mask_token=False)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MetaAdsExplorer/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                code = resp.getcode()
                raw = resp.read().decode("utf-8")
                data = json.loads(raw)
                formatted = json.dumps(data, indent=2, ensure_ascii=False)
                self.after(0, self._show_success, code, formatted)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8")
            try:
                data = json.loads(raw)
                formatted = json.dumps(data, indent=2, ensure_ascii=False)
            except Exception:
                formatted = raw
            self.after(0, self._show_error, e.code, formatted)
        except Exception as ex:
            self.after(0, self._show_error, None, str(ex))

    def _show_success(self, code, text):
        self.fetch_btn.config(state="normal", text="⟳  Fetch")
        self.resp_status.config(text=f"✓ {code} OK", fg="#2e7d32")
        self.status_label.config(text=f"{code} OK — {self.selected_account['name']} / {self.selected_endpoint['label']}", fg="#2e7d32")
        self._set_result(text, color="#1a1a1a")

    def _show_error(self, code, text):
        self.fetch_btn.config(state="normal", text="⟳  Fetch")
        label = f"✗ {code} Error" if code else "✗ Request failed"
        self.resp_status.config(text=label, fg="#c62828")
        self.status_label.config(text=label, fg="#c62828")
        self._set_result(text, color="#c62828")

    def _set_result(self, text, color="#1a1a1a"):
        self.result_text.config(state="normal")
        self.result_text.delete("1.0", "end")
        self.result_text.insert("end", text)
        self.result_text.config(fg=color, state="disabled")


if __name__ == "__main__":
    app = MetaAdsExplorer()
    app.mainloop()