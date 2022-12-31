import { App, CachedMetadata, FileSystemAdapter, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { QuipAPIClientError, QuipAPIClient } from './quipapi';
import render from './renderer';
import QuipSettingTab from './settings';

// Remember to rename these classes and interfaces!

interface QuipPluginSettings {
	hostname: string;
	token: string;
	removeYAML: boolean;
	addLink: boolean;
	inlineEmbeds: boolean;
}

const DEFAULT_SETTINGS: QuipPluginSettings = {
	hostname: 'platform.quip.com',
	token: '',
	removeYAML: true,
	addLink: true,
	inlineEmbeds: true
}

// TODO: move to quipapi.ts
enum DocumentFormat {
	HTML = "html",
	MARKDOWN = "markdown"
}

// TODO: move to quipapi.ts
interface NewDocumentOptions {
	content: string;
	title: string | undefined;
	format: DocumentFormat;
	memberIds: string[] | undefined;
}

export default class QuipPlugin extends Plugin {
	settings: QuipPluginSettings;

	async onload() {
		await this.loadSettings();


		this.addCommand({
			id: 'quip-publish-html',
			name: 'Publish as rendered HTML',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						let client = new QuipAPIClient(this.settings.hostname, this.settings.token);
						// Quip import likes to replace the first heading with the document title
						const htmlPromise = render(this, markdownView, markdownView.file.path);
						htmlPromise.then((html: string) => {
							console.log(html);
							let options: NewDocumentOptions = {
								content: html,
								title: undefined,
								format: DocumentFormat.HTML,
								memberIds: undefined
							};
							new Notice(`Publishing to ${this.settings.hostname}...`)
							client.newDocument(options, (error: QuipAPIClientError, response: any) => {
								if (error) {
									console.log(error);
									let text = JSON.stringify(error.info);
									new Notice(text);
								} else {
									this.onSuccessfulPublish(response.thread.link);
								}
							});
						});
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});
		this.addCommand({
			id: 'quip-publish-markdown',
			name: 'Publish as Markdown',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						let client = new QuipAPIClient(this.settings.hostname, this.settings.token);
						const contentPromise = preProcessMarkdown(this, markdownView.file);
						contentPromise.then((content:string) => {
							let options: NewDocumentOptions = {
								content: content,
								title: undefined,
								format: DocumentFormat.MARKDOWN,
								memberIds: undefined
							};
							new Notice(`Publishing to ${this.settings.hostname}...`)
							client.newDocument(options, (error: QuipAPIClientError, response: any) => {
								if (error) {
									console.log(error);
									let text = JSON.stringify(error.info);
									new Notice(text);
								} else {
									this.onSuccessfulPublish(response.thread.link);
								}
							});
						})
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new QuipSettingTab(this.app, this));
	}

	onSuccessfulPublish(link: string): void {
		console.log("Settings", this.settings);
		if (this.settings.addLink) {
			new Notice("Adding link to front matter");
			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			this.app.fileManager.processFrontMatter(markdownView.file,
				(frontMatter: any) => {
					console.log("Front matter", frontMatter);
					if ('quip' in frontMatter) {
						let quip = frontMatter.quip;
						if (Array.isArray(quip)) {
							quip.push(link);
						} else {
							frontMatter.quip = [quip, link];
						}
					} else {
						frontMatter.quip = link;
					}
					console.log("Front matter", frontMatter);
				})
		}
		new SuccessModal(this.app, link).open();

	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


export class SuccessModal extends Modal {
	link: string;

	constructor(app: App, link: string) {
	  super(app);
	  this.link = link;
	}
  
	onOpen() {
	  let { contentEl } = this;
	  //contentEl.setText(`Successfully published to ${this.link}`);
	  contentEl.createEl('span', null, (span) => {
		span.innerText = 'Successfully published to ';
		span.createEl('a', null, (anchor) => {
			anchor.href = this.link;
			anchor.innerText = this.link;
		});
	  })
	}
  
	onClose() {
	  let { contentEl } = this;
	  contentEl.empty();
	}
  }



async function preProcessMarkdown(plugin: QuipPlugin, file: TFile): Promise<string> {
    const adapter = plugin.app.vault.adapter as FileSystemAdapter;
	const title = file.basename;
	let content = await adapter.read(file.path);
	console.log('Raw markdown content', content)
	if (plugin.settings.removeYAML && content.startsWith('---')) {
		const end_marker = content.indexOf('---', 3);
		content = content.substring(end_marker + 3).trim();
		console.log('Content after trimming YAML front matter', content)
	}
	if (plugin.settings.inlineEmbeds) {
		const cache: CachedMetadata = this.app.metadataCache.getCache(file.path)
		console.log("Metadata", cache);
		if ('embeds' in cache) {
			for (const embed of cache.embeds) {
				console.log("Embed", embed);
				const subfolder = file.path.substring(adapter.getBasePath().length);  // TODO: this is messy
				const embeddedFile = plugin.app.metadataCache.getFirstLinkpathDest(embed.link, subfolder);
				const embeddedContent = await preProcessMarkdown(plugin, embeddedFile)
				console.log("Embedded Content", embeddedContent);
				content = content.replace(embed.original, embeddedContent);
			}
		}
	}
	// Quip import likes to replace the first heading with the document title
	content = `# ${title}\n${content}`;
	return content;
}