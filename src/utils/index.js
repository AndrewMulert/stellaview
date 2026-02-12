import express from 'express';
import path from 'path';

/** @type {Array<{route: string, dir: string}|string>} Static path configurations */
const staticPaths = [
    { route: '/css', dir: '/public/css' },
    { route: '/js', dir: '/public/js' },
    { route: '/images', dir: '/public/images' },
    /*{ route: '/audio', dir: '/public/audio'}*/
 ];
 
 /** Brother Keer's Unique Function
  * @param {Object} app - The Express application instance.
  */
 const configureStaticPaths = (app) => {
     // Track registered paths
     const registeredPaths = new Set(app.get('staticPaths') || []);
     
     staticPaths.forEach((pathConfig) => {
         const pathKey = typeof pathConfig === 'string' ? pathConfig : pathConfig.route;
         
         if (!registeredPaths.has(pathKey)) {
             registeredPaths.add(pathKey);
             
             if (typeof pathConfig === 'string') {
                 // Register the path directly
                 app.use(pathConfig, express.static(pathConfig));
             } else {
                 // Register the path with the specified route and directory
                 app.use(pathConfig.route, express.static(path.join(process.cwd(), pathConfig.dir)));
             }
         }
     });
 
     // Update the app settings with the newly registered paths
     app.set('staticPaths', Array.from(registeredPaths));
 };

 /**
 * Returns the navigation menu.
 *
 * @returns {string} The navigation menu.
 */

const getNav = () => {
    return `
    <nav class="nav_bar">
        <ul class="nav_items">
            <li class="nav_link_container" id="nav_home">
                <a href="/" class="nav_links" id="home_link">
                    <svg id="home_svg" width="45px" height="45px">
                        <image width="45px" height="45px" href="/images/logo_stellaview.svg" alt="StellaView: Watch the stars"></image>
                    </svg>
                </a>
            </li>
            <li class="nav_link_container" id="nav_search">
                <div class="nav_search_bar">
                    <input type="text" id="location_input" placeholder="Search a city">
                    <button id="search_btn">
                        <svg id="search_svg" width="30px" height="30px">
                            <image width="30px" height="30px" href="/images/icon_search.svg" alt="Search"></image>
                        </svg>
                    </button>
                </div>
            </li>
            <li class="nav_link_container" id="nav_clock">
                <div class="nav_clock_time">
                    <h3 id="home_time"></h3>
                </div>
            </li>
            <li class="nav_link_container" id="nav_profile">
                <a href="/" class="nav_links" id="profile_menu">
                    <svg id="profile_svg" width="30px" height="30px">
                        <image width="30px" height="30px" href="/images/icon_user.svg"></image>
                    </svg>
                </a>
            </li>
        </ul>
    </nav>`;
}

export { configureStaticPaths, getNav};