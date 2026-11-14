import * as githubService from '../services/githubService.js';

/**
 * T31: Handle incoming GitHub webhooks and forward to githubService
 */
export const handleWebhook = async (req, res, next) => {
    try {
        const result = await githubService.handleGitHubWebhook(req.body);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};