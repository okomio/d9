<template>
	<div v-if="type && !imgError" class="file-preview" :class="{ modal: inModal, small: isSmall, svg: isSVG }">
		<div v-if="type === 'image'" class="image" @click="$emit('click')">
			<v-image :src="assetSrc" :width="width" :height="height" :alt="title" @error="imgError = true" />
		</div>

		<div v-else-if="type === 'video'" class="video">
			<video controls :src="assetSrc" />
		</div>

		<audio v-else-if="type === 'audio'" controls :src="assetSrc" />

		<div v-else class="fallback">
			<v-icon-file :ext="type" />
		</div>
	</div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { readableMimeType } from '@/utils/readable-mime-type';
import { getPublicURL } from '@/utils/get-root-path';
import { getAssetGrantUrl } from '@/utils/get-asset-url';

interface Props {
	mime: string;
	width?: number;
	height?: number;
	src: string;
	title: string;
	inModal?: boolean;
}

defineEmits(['click']);

const props = withDefaults(defineProps<Props>(), { width: undefined, height: undefined, inModal: false });

const imgError = ref(false);

const type = computed<'image' | 'video' | 'audio' | string>(() => {
	if (props.mime === null) return 'unknown';

	if (props.mime.startsWith('image')) {
		return 'image';
	}

	if (props.mime.startsWith('video')) {
		return 'video';
	}

	if (props.mime.startsWith('audio')) {
		return 'audio';
	}

	return readableMimeType(props.mime, true) ?? 'unknown';
});

const isSVG = computed(() => props.mime.includes('svg'));

const maxHeight = computed(() => Math.min(props.height ?? 528, 528) + 'px');
const isSmall = computed(() => props.height < 528);

const assetSrc = ref('');

watch(
	[() => props.src, () => props.mime],
	async (_values, _oldValues, onCleanup) => {
		let current = true;
		onCleanup(() => (current = false));
		imgError.value = false;
		const url = new URL(props.src, getPublicURL()).href;

		if (type.value === 'image') {
			// VImage retrieves images with the active tab's Authorization header.
			assetSrc.value = url;
			return;
		}

		if (type.value !== 'video' && type.value !== 'audio') return;
		assetSrc.value = '';

		try {
			const granted = await getAssetGrantUrl(url);
			if (current) assetSrc.value = granted;
		} catch {
			if (current) imgError.value = true;
		}
	},
	{ immediate: true }
);
</script>

<style lang="scss" scoped>
.file-preview {
	position: relative;
	max-width: calc((var(--form-column-max-width) * 2) + var(--form-horizontal-gap));

	img,
	video {
		width: auto;
		height: auto;
	}

	audio {
		width: 100%;
	}

	img,
	video,
	audio {
		max-width: 100%;
		max-height: v-bind(maxHeight);
		object-fit: contain;
		border-radius: var(--border-radius);
	}

	.image,
	.video {
		background-color: var(--background-normal);
		border-radius: var(--border-radius);
	}

	.image {
		img {
			z-index: 1;
			display: block;
			margin: 0 auto;
		}
	}

	.video {
		display: flex;
		justify-content: center;

		video {
			min-height: 80px;
			min-width: 80px;
		}
	}

	.fallback {
		background-color: var(--background-normal);
		display: flex;
		align-items: center;
		justify-content: center;
		height: var(--input-height-tall);
		border-radius: var(--border-radius);
	}

	&.svg,
	&.small {
		.image {
			padding: 64px;
		}
	}

	&.modal {
		.image {
			background-color: transparent;
			border-radius: 0;
		}
	}
}
</style>
