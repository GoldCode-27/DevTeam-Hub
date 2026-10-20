// Import the express module  
import express from 'express';
// Call the router method from express to create the router 
const router = express.Router();
// Import the install controller 
import installController from '../controllers/install.controller.js';
// Create a route to handle the install request on get 
router.get('/install', installController.install);
// Export the router
export default router;