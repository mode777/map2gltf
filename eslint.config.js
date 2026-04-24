import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts', 'tests/**/*.ts', 'web/**/*.ts'],
        rules: {
            '@typescript-eslint/no-unused-vars': 'off',
            'no-unused-vars': 'off',
        },
    },
    {
        ignores: ['dist/**', 'dist-web/**', 'node_modules/**'],
    },
);
