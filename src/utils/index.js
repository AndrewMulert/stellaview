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
 * @param {Object} user - The authenticated user object
 * @returns {string} The navigation menu.
 */

const getNav = (user = null) => {
    const defaultIcon = '/images/icon_user.svg';
    const profilePic = user?.accountInfo?.profilePicture;
    
    const bgStyle = profilePic ? `style="background-image: url('${profilePic}'); background-size: cover; background-position: center;"` : '';
    const profileClass = profilePic ? 'has-profile-pic' : '';
    
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
                    <input type="text" id="location_input" placeholder="Search a city" autocomplete="off">
                    <!--<div id="autocomplete_dropdown" class="autocomplete-dropdown hidden"></div>-->
                    <button id="search_btn">
                        <svg id="search_svg" width="30px" height="30px">
                            <image width="30px" height="30px" href="/images/icon_search.svg" alt="Search"></image>
                        </svg>
                    </button>
                </div>
            </li>
            <li class="nav_link_container" id="nav_clock">
                <div class="nav_clock_time">
                    <svg id="nav_moon_container" width="24px" height="24px">
                        <title id="moon_tooltip"></title>
                        <image id="nav_moon_icon" width="24px" height="24px" href=/images/icon_moon_full.svg alt="Moon Phase"></image>
                    </svg>
                    <h3 id="home_time"></h3>
                </div>
            </li>
            <li class="nav_link_container ${profileClass}" id="nav_profile" ${bgStyle}>
                <a href="#" class="nav_links" id="profile_menu">
                    <svg id="profile_svg" width="30px" height="30px">
                        <image width="30px" height="30px" href="${defaultIcon}"></image>
                    </svg>
                </a>
            </li>
        </ul>
    </nav>`;
}

export { configureStaticPaths, getNav};