import installService from '../services/install.service.js';

async function install(req, res, next) {
  try {
    const installMessage = await installService.install();

    if (installMessage.status === 200) {
      return res.status(200).json({ message: installMessage.message });
    }

    return res.status(500).json({ message: installMessage.message });
  } catch (error) {
    next(error);
  }
}

export default { install };
