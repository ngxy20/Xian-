window.__ModuleLoader__.load({
	id: "@xian/optimizer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const ReactDOM = require("react-dom");

		const BUTTON_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			gap: 5,
			height: 28,
			padding: "0 9px",
			border: "1px solid rgba(127, 127, 127, 0.28)",
			borderRadius: 8,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			fontSize: 12,
			lineHeight: 1,
			cursor: "pointer",
			whiteSpace: "nowrap",
			userSelect: "none",
			transition: "background 120ms ease, border-color 120ms ease, opacity 120ms ease",
		};

		const OVERLAY_STYLE = {
			position: "fixed",
			inset: 0,
			zIndex: 2147483000,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 24,
			background: "rgba(0, 0, 0, 0.62)",
			backdropFilter: "blur(2px)",
		};

		const PANEL_STYLE = {
			width: "min(920px, 100%)",
			maxHeight: "84vh",
			display: "flex",
			flexDirection: "column",
			overflow: "hidden",
			borderRadius: 12,
			border: "1px solid rgba(127, 127, 127, 0.35)",
			background: "var(--dsw-alias-bg-base, #1b1b1c)",
			color: "var(--dsw-alias-label-primary, #f2f2f2)",
			boxShadow: "0 24px 80px rgba(0, 0, 0, 0.5)",
		};

		const FOOTER_STYLE = {
			display: "flex",
			alignItems: "center",
			justifyContent: "flex-end",
			gap: 8,
			padding: "12px 16px",
			borderTop: "1px solid rgba(127, 127, 127, 0.22)",
			flex: "none",
		};

		const MASCOT_CARD = {
			position: "fixed",
			right: 20,
			bottom: 96,
			zIndex: 2147482000,
			width: "min(342px, calc(100vw - 32px))",
			boxSizing: "border-box",
			padding: "12px 14px",
			borderRadius: 16,
			border: "1px solid rgba(120, 160, 255, 0.30)",
			background: "linear-gradient(145deg, rgba(22, 28, 48, 0.97), rgba(12, 16, 28, 0.95))",
			boxShadow: "0 18px 50px rgba(0, 0, 0, 0.48), inset 0 0 0 1px rgba(140, 180, 255, 0.06)",
			color: "#eef3ff",
			backdropFilter: "blur(10px)",
			pointerEvents: "auto",
			overflow: "hidden",
		};

		const MASCOT_MINI = {
			position: "fixed",
			right: 20,
			bottom: 96,
			zIndex: 2147482000,
			width: 62,
			height: 62,
			padding: 0,
			border: "1px solid rgba(120, 160, 255, 0.45)",
			borderRadius: "50%",
			cursor: "pointer",
			boxShadow: "0 12px 34px rgba(0, 0, 0, 0.5), 0 0 22px rgba(110, 168, 255, 0.18)",
			background: "conic-gradient(#67e8f9 0%, #6ea8ff 0%, rgba(255,255,255,.12) 0%)",
			color: "#eef3ff",
			overflow: "visible",
			pointerEvents: "auto",
		};

		const DEPTH_OPTIONS = [
			{ id: "fast", label: "快速", hint: "4 个位置 · 不兜底" },
			{ id: "standard", label: "标准", hint: "8 个位置 · 自动兜底" },
			{ id: "deep", label: "深度", hint: "12 个位置 · 强制兜底" },
			{ id: "max", label: "极致", hint: "15 个位置 · 长证据" },
		];

		function readStored(key, fallback) {
			try {
				const value = window.localStorage.getItem(key);
				return value === null ? fallback : value;
			} catch {
				return fallback;
			}
		}

		function writeStored(key, value) {
			try {
				window.localStorage.setItem(key, value);
			} catch {
				// storage is optional
			}
		}

		function depthOption(id) {
			return DEPTH_OPTIONS.find((item) => item.id === id) || DEPTH_OPTIONS[1];
		}

		const MASCOT_CSS = `
@keyframes xian-mascot-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
@keyframes xian-mascot-pulse { 0%,100% { opacity: .45; transform: scale(.92) } 50% { opacity: 1; transform: scale(1.08) } }
@keyframes xian-mascot-shine { 0% { transform: translateX(-120%) } 100% { transform: translateX(240%) } }
.xian-mascot-img { animation: xian-mascot-bob 2.8s ease-in-out infinite; }
.xian-mascot-dot { animation: xian-mascot-pulse 1.2s ease-in-out infinite; }
.xian-mascot-shine { animation: xian-mascot-shine 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .xian-mascot-img, .xian-mascot-dot, .xian-mascot-shine { animation: none !important; }
}`;

		function buttonStyle(kind) {
			if (kind === "primary") {
				return {
					height: 30,
					padding: "0 14px",
					border: "1px solid rgba(37, 99, 235, 0.8)",
					borderRadius: 8,
					background: "#2563eb",
					color: "#fff",
					font: "inherit",
					fontSize: 13,
					cursor: "pointer",
				};
			}
			return {
				height: 30,
				padding: "0 12px",
				border: "1px solid rgba(127, 127, 127, 0.35)",
				borderRadius: 8,
				background: "transparent",
				color: "inherit",
				font: "inherit",
				fontSize: 13,
				cursor: "pointer",
			};
		}

		function labelFor(phase) {
			if (phase === "loading") return "扫描中…";
			if (phase === "done") return "已生成";
			if (phase === "error") return "重试";
			return "Xian优化";
		}

		function titleFor(phase, message) {
			if (phase === "error") return message || "Xian优化器：优化失败，点击重试";
			if (phase === "done") return "已生成优化提示词，点击再次查看";
			if (phase === "loading") return "正在扫描项目并生成提示词…";
			return "Xian优化器：根据当前项目结构，把输入改写成带代码路径的可执行提示词";
		}

		function shortMeta(preview) {
			if (!preview) return "";
			const depth = Number.isFinite(preview.understanding) ? ` · 理解深度 ${preview.understanding}%` : "";
			return `置信度 ${preview.confidence || "未知"} · ${preview.fileCount} 个代码位置 · ${preview.chars} 字符${depth}`;
		}

		function installMascotStyle() {
			if (typeof document === "undefined" || !document.head) return;
			if (document.getElementById("xian-mascot-style")) return;
			const style = document.createElement("style");
			style.id = "xian-mascot-style";
			style.textContent = MASCOT_CSS;
			document.head.appendChild(style);
		}

		function clampPercent(value, fallback = 0) {
			const number = Number(value);
			if (!Number.isFinite(number)) return fallback;
			return Math.max(0, Math.min(100, Math.round(number)));
		}

		function XianMascot({ progress }) {
			const percent = clampPercent(progress.percent);
			const depth = clampPercent(progress.depth);
			const depthLabel = depth >= 80 ? "深入理解" : depth >= 55 ? "结构理解" : "初步了解";
			const stage = progress.label || "扫描项目中…";
			const detail = progress.detail || "正在读取项目结构";
			const useFront = percent >= 62;
			const [imgFailed, setImgFailed] = React.useState(false);
			return React.createElement(
				"div",
				{ style: MASCOT_CARD, role: "status", "aria-live": "polite", "data-xian-mascot": "widget" },
				React.createElement("div", {
					style: {
						position: "absolute",
						inset: 0,
						pointerEvents: "none",
						background: "radial-gradient(circle at 18% 12%, rgba(120, 160, 255, .18), transparent 42%), radial-gradient(circle at 92% 88%, rgba(139, 123, 255, .12), transparent 46%)",
					},
				}),
				imgFailed
					? React.createElement("div", {
						style: {
							position: "absolute",
							left: 16,
							bottom: 16,
							width: 84,
							height: 84,
							display: "grid",
							placeItems: "center",
							borderRadius: 18,
							fontSize: 36,
							background: "rgba(120, 160, 255, 0.12)",
							color: "#9fc0ff",
						},
					}, "✦")
					: React.createElement("img", {
						src: useFront ? "/api/xian/asset?name=front" : "/api/xian/asset?name=side",
						alt: "Xian 角色",
						className: "xian-mascot-img",
						onError: () => setImgFailed(true),
						style: {
							position: "absolute",
							left: 8,
							bottom: 6,
							width: 104,
							height: 132,
							objectFit: "contain",
							filter: "drop-shadow(0 10px 18px rgba(0, 0, 0, 0.45))",
						},
					}),
				React.createElement(
					"div",
					{ style: { position: "relative", marginLeft: 104, minHeight: 132, display: "flex", flexDirection: "column", justifyContent: "center" } },
					React.createElement(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#cfe0ff", letterSpacing: 0.2 } },
						React.createElement("span", {
							className: "xian-mascot-dot",
							style: { width: 6, height: 6, borderRadius: 99, background: "#7dd3fc", boxShadow: "0 0 10px rgba(125, 211, 252, .8)" },
						}),
						React.createElement("span", null, "Xian优化器"),
						React.createElement("span", { style: { marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: "#9fc0ff", fontWeight: 600 } }, `${percent}%`),
					),
					React.createElement("div", { style: { marginTop: 8, fontSize: 13, fontWeight: 600, lineHeight: 1.35 } }, stage),
					React.createElement("div", { style: { marginTop: 3, fontSize: 11.5, color: "rgba(220, 230, 255, .62)", lineHeight: 1.4, minHeight: 16 } }, detail),
					React.createElement(
						"div",
						{ style: { marginTop: 10, height: 6, borderRadius: 999, background: "rgba(255, 255, 255, .10)", overflow: "hidden", position: "relative" } },
						React.createElement("div", {
							style: {
								width: `${percent}%`,
								height: "100%",
								borderRadius: 999,
								background: "linear-gradient(90deg, #6ea8ff, #a78bfa)",
								transition: "width 420ms ease",
								position: "relative",
							},
						}, React.createElement("div", {
							className: "xian-mascot-shine",
							style: {
								position: "absolute",
								inset: 0,
								width: "40%",
								background: "linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent)",
							},
						})),
					),
					React.createElement(
						"div",
						{ style: { marginTop: 7, display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "rgba(220, 230, 255, .66)" } },
						React.createElement("span", { style: { flex: "none" } }, "理解深度"),
						React.createElement(
							"div",
							{ style: { flex: 1, height: 4, borderRadius: 999, background: "rgba(255, 255, 255, .10)", overflow: "hidden" } },
							React.createElement("div", {
								style: {
									width: `${depth}%`,
									height: "100%",
									borderRadius: 999,
									background: "linear-gradient(90deg, #67e8f9, #a78bfa)",
									transition: "width 420ms ease",
								},
							}),
						),
						React.createElement("span", { style: { flex: "none", fontVariantNumeric: "tabular-nums", color: "#a5f3fc" } }, `${depth}% · ${depthLabel}`),
					),
				),
			);
		}

		function XianWidget({ open, onToggle, onRefresh, onDepth, depth, insight, insightLoading, insightError, phase, progress }) {
			const loading = phase === "loading";
			const understanding = clampPercent(loading ? progress.depth : insight && insight.understanding, 0);
			const percent = loading ? clampPercent(progress.percent) : understanding;
			const understandingLabel = understanding >= 80 ? "深入理解" : understanding >= 55 ? "结构理解" : "初步了解";
			const depthInfo = depthOption(depth);
			const projectName = (insight && insight.name) || "当前项目";
			const imageName = loading ? "side" : "front";
			const [imgFailed, setImgFailed] = React.useState(false);

			if (!open) {
				return React.createElement(
					"button",
					{
						type: "button",
						onClick: onToggle,
						title: `Xian优化器 · ${projectName} · 理解程度 ${understanding}% · 点击展开`,
						"data-xian-mascot": "mini",
						style: {
							...MASCOT_MINI,
							background: `conic-gradient(${understanding >= 55 ? "#67e8f9" : "#6ea8ff"} ${understanding}%, rgba(255,255,255,.13) 0%)`,
						},
					},
					React.createElement(
						"span",
						{
							style: {
								position: "absolute",
								inset: 3,
								borderRadius: "50%",
								overflow: "hidden",
								background: "#131a2a",
								display: "grid",
								placeItems: "center",
							},
						},
						imgFailed
							? React.createElement("span", { style: { fontSize: 25, color: "#9fc0ff" } }, "✦")
							: React.createElement("img", {
								src: "/api/xian/asset?name=face",
								alt: "Xian",
								onError: () => setImgFailed(true),
								style: { width: "100%", height: "100%", objectFit: "cover" },
							}),
					),
					React.createElement(
						"span",
						{
							style: {
								position: "absolute",
								right: -5,
								bottom: -4,
								minWidth: 28,
								height: 18,
								padding: "0 5px",
								borderRadius: 9,
								background: "#0d1322",
								border: "1px solid rgba(120,160,255,.45)",
								color: "#a5f3fc",
								fontSize: 10,
								lineHeight: "16px",
								fontVariantNumeric: "tabular-nums",
							},
						},
						`${understanding}%`,
					),
				);
			}

			const metric = (label, value) => React.createElement(
				"div",
				{ style: { padding: "7px 8px", borderRadius: 9, background: "rgba(255,255,255,.055)", border: "1px solid rgba(140,180,255,.10)" } },
				React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: "#eaf1ff", fontVariantNumeric: "tabular-nums" } }, value ?? "—"),
				React.createElement("div", { style: { marginTop: 1, fontSize: 10, color: "rgba(210,225,255,.55)" } }, label),
			);
			const coverage = (label, value) => React.createElement(
				"div",
				{ style: { display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "rgba(210,225,255,.62)" } },
				React.createElement("span", { style: { width: 48, flex: "none" } }, label),
				React.createElement(
					"div",
					{ style: { flex: 1, height: 4, borderRadius: 999, background: "rgba(255,255,255,.10)", overflow: "hidden" } },
					React.createElement("div", { style: { width: `${clampPercent(value)}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg,#67e8f9,#a78bfa)" } }),
				),
				React.createElement("span", { style: { width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" } }, `${clampPercent(value)}%`),
			);

			return React.createElement(
				"div",
				{
					style: { ...MASCOT_CARD, maxHeight: "min(540px, calc(100vh - 130px))", overflowY: "auto" },
					role: "region",
					"aria-label": "Xian 项目理解挂件",
					"data-xian-mascot": "widget",
					"data-xian-phase": phase,
				},
				React.createElement("div", {
					style: {
						position: "absolute",
						inset: 0,
						pointerEvents: "none",
						background: "radial-gradient(circle at 18% 12%, rgba(120, 160, 255, .18), transparent 42%), radial-gradient(circle at 92% 88%, rgba(139, 123, 255, .12), transparent 46%)",
					},
				}),
				imgFailed
					? React.createElement("div", {
						style: {
							position: "absolute",
							left: 14,
							top: 58,
							width: 88,
							height: 112,
							display: "grid",
							placeItems: "center",
							borderRadius: 18,
							fontSize: 38,
							background: "rgba(120, 160, 255, 0.12)",
							color: "#9fc0ff",
						},
					}, "✦")
					: React.createElement("img", {
						src: `/api/xian/asset?name=${imageName}`,
						alt: "Xian 角色",
						className: "xian-mascot-img",
						onError: () => setImgFailed(true),
						style: {
							position: "absolute",
							left: 10,
							top: 48,
							width: 98,
							height: 126,
							objectFit: "contain",
							filter: "drop-shadow(0 10px 18px rgba(0, 0, 0, 0.45))",
						},
					}),
				React.createElement(
					"div",
					{ style: { position: "relative", display: "flex", alignItems: "center", gap: 6, minHeight: 22 } },
					React.createElement("span", {
						className: "xian-mascot-dot",
						style: { width: 6, height: 6, borderRadius: 99, background: loading ? "#7dd3fc" : "#34d399", boxShadow: "0 0 10px rgba(125, 211, 252, .8)" },
					}),
					React.createElement("span", { style: { fontSize: 12, color: "#cfe0ff", letterSpacing: 0.2 } }, loading ? "Xian · 扫描中" : "Xian · 项目理解"),
					React.createElement("span", { style: { marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: "#9fc0ff", fontWeight: 600, fontSize: 12 } }, `${percent}%`),
					React.createElement(
						"button",
						{
							type: "button",
							onClick: onToggle,
							title: "收起挂件",
							"aria-label": "收起 Xian 挂件",
							style: { width: 22, height: 22, border: "1px solid rgba(127,127,127,.25)", borderRadius: 7, background: "transparent", color: "rgba(230,238,255,.72)", cursor: "pointer", lineHeight: "18px" },
						},
						"－",
					),
				),
				React.createElement(
					"div",
					{ style: { position: "relative", marginLeft: 104, minHeight: 124, display: "flex", flexDirection: "column", justifyContent: "center" } },
					React.createElement("div", { style: { fontSize: 14, fontWeight: 600, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, loading ? (progress.label || "扫描项目中…") : projectName),
					React.createElement("div", { style: { marginTop: 3, fontSize: 11, color: "rgba(220,230,255,.62)", lineHeight: 1.45, minHeight: 30 } }, loading
						? (progress.detail || "正在读取项目结构")
						: insight
							? `${insight.files} 文件 · ${insight.directories} 目录 · ${insight.size}`
							: insightError || (insightLoading ? "正在读取项目参数…" : "等待项目扫描")),
					React.createElement(
						"div",
						{ style: { marginTop: 10, height: 6, borderRadius: 999, background: "rgba(255, 255, 255, .10)", overflow: "hidden", position: "relative" } },
						React.createElement("div", {
							style: {
								width: `${percent}%`,
								height: "100%",
								borderRadius: 999,
								background: "linear-gradient(90deg, #6ea8ff, #a78bfa)",
								transition: "width 420ms ease",
								position: "relative",
							},
						}, React.createElement("div", {
							className: "xian-mascot-shine",
							style: { position: "absolute", inset: 0, width: "40%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent)" },
						})),
					),
					React.createElement(
						"div",
						{ style: { marginTop: 7, display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "rgba(220, 230, 255, .66)" } },
						React.createElement("span", { style: { flex: "none" } }, loading ? "扫描进度" : "理解深度"),
						React.createElement(
							"div",
							{ style: { flex: 1, height: 4, borderRadius: 999, background: "rgba(255, 255, 255, .10)", overflow: "hidden" } },
							React.createElement("div", {
								style: { width: `${understanding}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #67e8f9, #a78bfa)", transition: "width 420ms ease" },
							}),
						),
						React.createElement("span", { style: { flex: "none", fontVariantNumeric: "tabular-nums", color: "#a5f3fc" } }, `${understanding}% · ${understandingLabel}`),
					),
				),
				React.createElement(
					"div",
					{ style: { position: "relative", marginTop: 10, borderTop: "1px solid rgba(127,127,127,.16)", paddingTop: 9 } },
					loading
						? null
						: React.createElement(
							React.Fragment,
							null,
							React.createElement(
								"div",
								{ style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 } },
								metric("文件", insight?.files),
								metric("符号", insight?.symbols),
								metric("测试", insight?.tests),
								metric("导入", insight?.imports),
							),
							React.createElement(
								"div",
								{ style: { display: "grid", gap: 4, marginTop: 7 } },
								coverage("符号覆盖", insight?.symbolCoverage),
								coverage("导入覆盖", insight?.importCoverage),
							),
							React.createElement(
								"div",
								{ style: { marginTop: 7, fontSize: 10.5, lineHeight: 1.5, color: "rgba(210,225,255,.58)" } },
								React.createElement("div", null, `框架：${(insight?.frameworks || []).slice(0, 3).map((item) => item.name).join("、") || "未识别"}`),
								React.createElement("div", null, `入口：${(insight?.entrypoints || []).slice(0, 2).join("、") || "未识别"}`),
							),
						),
					React.createElement(
						"div",
						{ style: { marginTop: 9, display: "flex", alignItems: "center", gap: 8 } },
						React.createElement("span", { style: { fontSize: 11, color: "rgba(210,225,255,.62)" } }, "优化深度"),
						React.createElement("span", { style: { marginLeft: "auto", fontSize: 10, color: "rgba(210,225,255,.45)" } }, depthInfo.hint),
					),
					React.createElement(
						"div",
						{ style: { marginTop: 5, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 } },
						DEPTH_OPTIONS.map((item) => React.createElement(
							"button",
							{
								key: item.id,
								type: "button",
								disabled: loading,
								onClick: () => onDepth(item.id),
								title: item.hint,
								"data-xian-depth": item.id,
								style: {
									height: 25,
									borderRadius: 7,
									border: `1px solid ${depth === item.id ? "rgba(110,168,255,.75)" : "rgba(127,127,127,.26)"}`,
									background: depth === item.id ? "rgba(80,120,255,.22)" : "transparent",
									color: depth === item.id ? "#dbeafe" : "rgba(220,230,255,.68)",
									fontSize: 11,
									cursor: loading ? "not-allowed" : "pointer",
									opacity: loading ? 0.55 : 1,
								},
							},
							item.label,
						)),
					),
					React.createElement(
						"div",
						{ style: { marginTop: 8, display: "flex", alignItems: "center", gap: 6 } },
						React.createElement(
							"button",
							{
								type: "button",
								onClick: onRefresh,
								disabled: loading || insightLoading,
								title: "重新扫描当前项目",
								style: { ...buttonStyle("secondary"), height: 25, fontSize: 11, padding: "0 9px", opacity: loading || insightLoading ? 0.55 : 1 },
							},
							insightLoading ? "理解中…" : "重新理解",
						),
						insightError ? React.createElement("span", { style: { fontSize: 10, color: "#fbbf24", lineHeight: 1.35 } }, insightError) : null,
					),
				),
			);
		}

		async function copyToClipboard(text) {
			try {
				if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
					await navigator.clipboard.writeText(text);
					return true;
				}
			} catch {
				// fall through to the textarea fallback
			}
			try {
				const area = document.createElement("textarea");
				area.value = text;
				area.setAttribute("readonly", "");
				area.style.position = "fixed";
				area.style.left = "-9999px";
				document.body.appendChild(area);
				area.select();
				const ok = document.execCommand("copy");
				document.body.removeChild(area);
				return ok === true;
			} catch {
				return false;
			}
		}

		function XianPreview({ preview, copyState, onClose, onCopy, onReplace }) {
			const warnings = Array.isArray(preview.warnings) ? preview.warnings.filter(Boolean).slice(0, 4) : [];
			return React.createElement(
				"div",
				{
					style: OVERLAY_STYLE,
					role: "presentation",
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) onClose();
					},
				},
				React.createElement(
					"section",
					{
						style: PANEL_STYLE,
						role: "dialog",
						"aria-modal": "true",
						"aria-label": "Xian优化结果",
						"data-xian-preview": "dialog",
					},
					React.createElement(
						"header",
						{
							style: {
								display: "flex",
								alignItems: "center",
								gap: 10,
								padding: "12px 16px",
								borderBottom: "1px solid rgba(127, 127, 127, 0.22)",
								flex: "none",
							},
						},
						React.createElement("span", { style: { fontSize: 15, fontWeight: 600 } }, "✦ Xian优化结果"),
						React.createElement("span", { style: { opacity: 0.65, fontSize: 12 } }, shortMeta(preview)),
						React.createElement("span", { style: { flex: 1 } }),
						React.createElement(
							"button",
							{
								type: "button",
								style: buttonStyle("secondary"),
								onClick: onClose,
								"aria-label": "关闭预览",
							},
							"关闭",
						),
					),
					warnings.length > 0
						? React.createElement(
							"div",
							{
								style: {
									padding: "8px 16px",
									color: "#fbbf24",
									fontSize: 12,
									lineHeight: 1.5,
									borderBottom: "1px solid rgba(127, 127, 127, 0.18)",
									flex: "none",
								},
							},
							warnings.map((warning, index) => React.createElement("div", { key: index }, `注意：${warning}`)),
						)
						: null,
					React.createElement("pre", {
						style: {
							flex: 1,
							minHeight: 0,
							margin: 0,
							padding: 16,
							overflow: "auto",
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							userSelect: "text",
							background: "rgba(0, 0, 0, 0.24)",
							fontFamily: "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace)",
							fontSize: 12,
							lineHeight: 1.6,
						},
						"data-xian-preview": "prompt",
					}, preview.prompt),
					React.createElement(
						"footer",
						{ style: FOOTER_STYLE },
						copyState
							? React.createElement("span", { style: { marginRight: "auto", fontSize: 12, opacity: 0.75 } }, copyState)
							: React.createElement("span", { style: { marginRight: "auto", fontSize: 12, opacity: 0.55 } }, "建议先检查代码路径，再替换或复制。"),
						React.createElement(
							"button",
							{
								type: "button",
								style: buttonStyle("secondary"),
								onClick: onReplace,
								title: "内容通常有数千字，替换后输入框会变高；如显示异常请改用复制",
								"data-xian-preview": "replace",
							},
							"替换输入框",
						),
						React.createElement(
							"button",
							{
								type: "button",
								style: buttonStyle("primary"),
								onClick: onCopy,
								"data-xian-preview": "copy",
							},
							"复制提示词",
						),
					),
				),
			);
		}

		class StreamUnavailable extends Error {
			constructor() {
				super("stream unavailable");
				this.code = "xian/stream-unavailable";
			}
		}

		function MascotBadge() {
			const [failed, setFailed] = React.useState(false);
			if (failed) {
				return React.createElement("span", { style: { fontSize: 13, lineHeight: 1 }, "aria-hidden": true }, "✦");
			}
			return React.createElement("img", {
				src: "/api/xian/asset?name=face",
				alt: "",
				"aria-hidden": true,
				onError: () => setFailed(true),
				style: {
					width: 18,
					height: 18,
					borderRadius: "50%",
					objectFit: "cover",
					background: "rgba(120, 160, 255, 0.14)",
					boxShadow: "0 0 0 1px rgba(140, 180, 255, 0.35)",
					flex: "none",
				},
			});
		}

		function XianButton({ useInput, useSessions, inputActions, sessionId }) {
			const draft = useInput((state) => (state && typeof state.draft === "string" ? state.draft : ""));
			const inputPhase = useInput((state) => (state && typeof state.phase === "string" ? state.phase : ""));
			const cwd = useSessions((state) => {
				const row = state && state.byId ? state.byId[sessionId] : undefined;
				return row && typeof row.cwd === "string" ? row.cwd : "";
			});
			const [phase, setPhase] = React.useState("idle");
			const [message, setMessage] = React.useState("");
			const [hovered, setHovered] = React.useState(false);
			const [preview, setPreview] = React.useState(null);
			const [copyState, setCopyState] = React.useState("");
			const [progress, setProgress] = React.useState({ percent: 0, depth: 0, label: "准备中", detail: "" });
			const [widgetOpen, setWidgetOpen] = React.useState(() => readStored("xian-widget-open", "true") !== "false");
			const [depth, setDepth] = React.useState(() => {
				const stored = readStored("xian-depth", "standard");
				return DEPTH_OPTIONS.some((item) => item.id === stored) ? stored : "standard";
			});
			const [insight, setInsight] = React.useState(null);
			const [insightLoading, setInsightLoading] = React.useState(false);
			const [insightError, setInsightError] = React.useState("");
			const [insightNonce, setInsightNonce] = React.useState(0);
			const timer = React.useRef(null);
			const progressTimer = React.useRef(null);

			React.useEffect(() => () => {
				if (timer.current) clearTimeout(timer.current);
				if (progressTimer.current) clearInterval(progressTimer.current);
			}, []);

			React.useEffect(() => {
				installMascotStyle();
			}, []);

			React.useEffect(() => {
				if (!cwd) {
					setInsight(null);
					setInsightError("");
					setInsightLoading(false);
					return undefined;
				}
				let cancelled = false;
				setInsightLoading(true);
				setInsightError("");
				fetch("/api/xian/insight", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ cwd, refresh: insightNonce > 0 }),
				})
					.then(async (response) => {
						const payload = await response.json().catch(() => null);
						if (!response.ok || !payload || payload.ok !== true) {
							throw new Error(payload && payload.error && payload.error.message
								? payload.error.message
								: `项目理解失败（HTTP ${response.status}）`);
						}
						return payload;
					})
					.then((payload) => {
						if (!cancelled && payload.profile) setInsight(payload.profile);
					})
					.catch((error) => {
						if (!cancelled) setInsightError(error instanceof Error ? error.message : String(error));
					})
					.finally(() => {
						if (!cancelled) setInsightLoading(false);
					});
				return () => { cancelled = true; };
			}, [cwd, insightNonce]);

			React.useEffect(() => {
				if (!preview) return undefined;
				const onKeyDown = (event) => {
					if (event.key === "Escape") closePreview();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [preview]);

			function changeDepth(next) {
				if (!DEPTH_OPTIONS.some((item) => item.id === next)) return;
				setDepth(next);
				writeStored("xian-depth", next);
			}

			function toggleWidget() {
				setWidgetOpen((previous) => {
					const next = !previous;
					writeStored("xian-widget-open", next ? "true" : "false");
					return next;
				});
			}

			function refreshInsight() {
				setInsightNonce((value) => value + 1);
			}

			function stopProgressTimer() {
				if (progressTimer.current) {
					clearInterval(progressTimer.current);
					progressTimer.current = null;
				}
			}

			function beginProgress() {
				stopProgressTimer();
				setProgress({ percent: 3, depth: 4, label: "连接宿主", detail: "准备扫描项目" });
				progressTimer.current = setInterval(() => {
					setProgress((previous) => {
						if (!previous || previous.percent >= 82) return previous;
						const next = Math.min(82, previous.percent + 1 + Math.random() * 2);
						return {
							...previous,
							percent: Math.round(next),
							depth: Math.min(90, Math.round(previous.depth + 0.8)),
							label: previous.percent < 20 ? "扫描项目目录" : previous.percent < 55 ? "解析符号与导入" : "匹配相关代码",
							detail: previous.percent < 20 ? "正在读取文件清单" : previous.percent < 55 ? "正在构建项目索引" : "正在排序候选位置",
						};
					});
				}, 500);
			}

			function closePreview() {
				if (timer.current) {
					clearTimeout(timer.current);
					timer.current = null;
				}
				setPreview(null);
				setCopyState("");
				setPhase("idle");
				setMessage("");
			}

			function handleStreamEvent(event, state) {
				if (!event || typeof event !== "object") return;
				if (event.type === "progress") {
					setProgress({
						percent: clampPercent(event.percent, state.percent),
						depth: clampPercent(event.depth, state.depth),
						label: typeof event.label === "string" ? event.label : "扫描项目中…",
						detail: typeof event.detail === "string" ? event.detail : "",
					});
					return;
				}
				if (event.type === "result") {
					state.result = event;
					return;
				}
				if (event.type === "error") {
					const error = new Error(event.error && event.error.message ? event.error.message : "宿主返回了错误。");
					throw error;
				}
			}

			async function streamOptimize(text, root, depthId) {
				const response = await fetch("/api/xian/optimize-stream", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ prompt: text, cwd: root, depth: depthId }),
				});
				if (!response.ok) {
					const payload = await response.json().catch(() => null);
					if (response.status === 404) throw new StreamUnavailable();
					throw new Error(payload && payload.error && payload.error.message
						? payload.error.message
						: `Xian 优化失败（HTTP ${response.status}）`);
				}
				const contentType = response.headers.get("content-type") || "";
				if (!response.body || !contentType.includes("ndjson")) throw new StreamUnavailable();
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				const state = { percent: 0, depth: 0, result: null };
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) {
						if (!line.trim()) continue;
						let event;
						try {
							event = JSON.parse(line);
						} catch {
							continue;
						}
						handleStreamEvent(event, state);
					}
				}
				if (buffer.trim()) {
					try {
						handleStreamEvent(JSON.parse(buffer), state);
					} catch (error) {
						if (error && error.message && error.message !== "Unexpected end of JSON input") throw error;
					}
				}
				if (!state.result) throw new StreamUnavailable();
				return state.result;
			}

			async function fallbackOptimize(text, root, depthId) {
				setProgress((previous) => ({
					...previous,
					percent: Math.max(previous.percent, 70),
					depth: Math.max(previous.depth, 74),
					label: "生成提示词",
					detail: "宿主未启用流式进度，已切换普通模式",
				}));
				const response = await fetch("/api/xian/optimize", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ prompt: text, cwd: root, depth: depthId }),
				});
				const payload = await response.json().catch(() => null);
				if (!response.ok || !payload || payload.ok !== true) {
					throw new Error(payload && payload.error && payload.error.message
						? payload.error.message
						: `Xian 优化失败（HTTP ${response.status}）`);
				}
				return payload;
			}

			async function run() {
				if (phase === "loading") return;
				if (preview) return;
				if (timer.current) {
					clearTimeout(timer.current);
					timer.current = null;
				}
				const text = typeof draft === "string" ? draft.trim() : "";
				if (!text) {
					setPhase("error");
					setMessage("先在输入框写一句需求，再点 Xian优化。");
					return;
				}
				if (inputPhase && inputPhase !== "plain") {
					setPhase("error");
					setMessage("输入框正在提交/处理，请稍后再试。");
					return;
				}
				if (!cwd) {
					setPhase("error");
					setMessage("当前会话没有绑定工作区，无法确定项目路径。请先打开一个项目。");
					return;
				}
				if (text.includes("## 3. 代码定位")) {
					setPhase("error");
					setMessage("当前内容已经是优化后的提示词；请先改回简短需求再优化。");
					return;
				}

				setPhase("loading");
				setMessage("");
				setWidgetOpen(true);
				beginProgress();
				try {
					let payload;
					try {
						payload = await streamOptimize(text, cwd, depth);
					} catch (error) {
						if (error && error.code === "xian/stream-unavailable") payload = await fallbackOptimize(text, cwd, depth);
						else throw error;
					}
					if (!payload || payload.ok !== true || typeof payload.prompt !== "string" || !payload.prompt.trim()) {
						throw new Error(payload && payload.error && payload.error.message
							? payload.error.message
							: "宿主返回了空提示词。");
					}
					stopProgressTimer();
					setProgress({
						percent: 100,
						depth: clampPercent(payload.understanding, 88),
						label: "优化完成",
						detail: `${Array.isArray(payload.files) ? payload.files.length : 0} 个代码位置`,
					});
					setPreview({
						prompt: payload.prompt,
						confidence: payload.confidence,
						fileCount: Array.isArray(payload.files) ? payload.files.length : 0,
						chars: payload.promptChars || payload.prompt.length,
						understanding: clampPercent(payload.understanding, 0),
						depthLabel: payload.depthLabel || depthOption(depth).label,
						warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
					});
					if (payload.project || payload.stats) {
						setInsight((previous) => ({
							...(previous || {}),
							name: payload.project?.name ?? previous?.name ?? "当前项目",
							files: payload.stats?.files ?? previous?.files,
							size: payload.stats?.totalSize ?? previous?.size,
							languages: payload.project?.languages ?? previous?.languages ?? [],
							frameworks: payload.project?.frameworks ?? previous?.frameworks ?? [],
							entrypoints: payload.project?.entrypoints ?? previous?.entrypoints ?? [],
							commands: payload.project?.commands ?? previous?.commands ?? [],
							understanding: clampPercent(payload.understanding, previous?.understanding ?? 0),
						}));
					}
					setPhase("done");
					setMessage(`置信度 ${payload.confidence || "未知"} · ${Array.isArray(payload.files) ? payload.files.length : 0} 个代码位置`);
					setInsightNonce((value) => value + 1);
				} catch (error) {
					stopProgressTimer();
					setPhase("error");
					setMessage(error instanceof Error ? error.message : String(error));
				}
			}

			async function handleCopy() {
				if (!preview) return;
				const ok = await copyToClipboard(preview.prompt);
				setCopyState(ok ? "已复制到剪贴板" : "复制失败，请手动全选复制");
				if (ok) {
					timer.current = setTimeout(() => setCopyState(""), 2200);
				}
			}

			function handleReplace() {
				if (!preview) return;
				if (!inputActions || typeof inputActions.setDraft !== "function") {
					setCopyState("当前输入框不可写，请改用复制。");
					return;
				}
				try {
					inputActions.setDraft(preview.prompt);
					closePreview();
				} catch (error) {
					setCopyState(`替换失败：${error instanceof Error ? error.message : String(error)}`);
				}
			}

			const busy = Boolean(inputPhase && inputPhase !== "plain");
			const style = {
				...BUTTON_STYLE,
				opacity: phase === "loading" || busy ? 0.55 : 0.94,
				borderColor: phase === "error" ? "rgba(220, 38, 38, 0.55)" : hovered ? "rgba(127, 127, 127, 0.55)" : "rgba(127, 127, 127, 0.28)",
				background: phase === "done" ? "rgba(22, 163, 74, 0.10)" : hovered ? "rgba(127, 127, 127, 0.08)" : "transparent",
				cursor: phase === "loading" || busy ? "not-allowed" : "pointer",
			};

			const button = React.createElement(
				"button",
				{
					type: "button",
					style,
					disabled: phase === "loading" || busy,
					onClick: run,
					onMouseEnter: () => setHovered(true),
					onMouseLeave: () => setHovered(false),
					title: titleFor(phase, message),
					"aria-label": "Xian优化器：根据项目结构优化提示词",
					"data-xian-optimizer": "composer",
				},
				React.createElement(MascotBadge),
				React.createElement("span", null, labelFor(phase)),
			);

			const portals = [];
			if (cwd && typeof document !== "undefined") {
				portals.push(ReactDOM.createPortal(
					React.createElement(XianWidget, {
						open: widgetOpen,
						onToggle: toggleWidget,
						onRefresh: refreshInsight,
						onDepth: changeDepth,
						depth,
						insight,
						insightLoading,
						insightError,
						phase,
						progress,
					}),
					document.body,
					"xian-widget",
				));
			}
			if (preview && typeof document !== "undefined") {
				portals.push(ReactDOM.createPortal(
					React.createElement(XianPreview, {
						preview,
						copyState,
						onClose: closePreview,
						onCopy: handleCopy,
						onReplace: handleReplace,
					}),
					document.body,
					"xian-preview",
				));
			}
			if (portals.length === 0) return button;
			return React.createElement(React.Fragment, null, button, ...portals);
		}

		function apply(ctx) {
			return ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "xian-optimizer",
				order: 50,
			}, XianButton));
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
