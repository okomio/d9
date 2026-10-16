import { App } from 'vue';
import ClickOutside from './click-outside';
import ContextMenu from './context-menu';
import Focus from './focus';
import Tooltip from './tooltip';
import Markdown from './markdown';
import AssetGrantLink from './asset-grant-link';

export function registerDirectives(app: App): void {
	app.directive('click-outside', ClickOutside);
	app.directive('context-menu', ContextMenu);
	app.directive('focus', Focus);
	app.directive('tooltip', Tooltip);
	app.directive('md', Markdown);
	app.directive('asset-grant-link', AssetGrantLink);
}
