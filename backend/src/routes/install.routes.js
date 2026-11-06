// Import the express module  
import express from 'express';
// Call the router method from express to create the router 
const router = express.Router();
// Import the install controller 
import installController from '../controllers/install.controller.js';
// Create a route to handle the install request on post 
router.post('/', installController.install);
router.get('/', (req, res) => {
  res.set('Allow', 'POST');
  return res.status(405).json({
    message: 'Use POST /api/install to run the database installer.'
  });
});
// Export the router
export default router;